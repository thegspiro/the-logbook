"""
Users API Endpoints

Endpoints for user management and listing.
"""

from datetime import datetime, timezone
from typing import Optional
from uuid import UUID

from fastapi import (
    APIRouter,
    BackgroundTasks,
    Depends,
    File,
    HTTPException,
    Query,
    Request,
    UploadFile,
    status,
)
from fastapi.responses import JSONResponse
from loguru import logger
from sqlalchemy import and_, func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.dependencies import (
    _collect_user_permissions,
    _has_permission,
    get_current_user,
    require_permission,
)
from app.core.audit import log_audit_event
from app.core.config import settings
from app.core.constants import ROLE_MEMBER
from app.core.database import database_manager, get_db
from app.core.error_codes import CodedHTTPException, ErrorCode
from app.core.permissions import get_rank_default_permissions
from app.core.security_middleware import check_rate_limit, get_client_ip
from app.core.utils import safe_error_detail
from app.models.audit import AuditLog
from app.models.document import Document
from app.models.inventory import ItemAssignment, ItemIssuance
from app.models.training import TrainingRecord as TrainingRecordModel
from app.models.user import Role, User, UserStatus, user_roles
from app.schemas.role import UserRoleAssignment, UserRoleResponse
from app.schemas.user import (
    AdminPasswordReset,
    AdminUserCreate,
    ContactInfoUpdate,
    DeletionImpactResponse,
    MemberAuditLogEntry,
    NotificationPreferences,
    UserListResponse,
    UserProfileResponse,
    UserUpdate,
    UserWithRolesResponse,
)
from app.services.admin_continuity_service import (
    LastAdministratorError,
    assert_not_last_administrator,
    assert_positions_retain_administrator,
)
from app.services.operational_rank_service import (
    OperationalRankService,
    rank_not_configured_message,
)
from app.services.organization_service import OrganizationService
from app.services.security_monitoring import report_privilege_escalation_attempt
from app.services.user_deletion_service import (
    find_hard_delete_blockers,
    release_user_references,
)
from app.services.user_service import UserService
from app.utils.membership import (
    ADMINISTRATIVE_RANK_MESSAGE,
    is_administrative,
)
from app.utils.security_notifications import notify_security_event

router = APIRouter()


async def _rate_limit_admin_reset(request: Request) -> None:
    """Rate limit admin password resets: 5 per 5 minutes."""
    await check_rate_limit(
        request,
        max_requests=5,
        window_seconds=300,
        lockout_seconds=900,
        scope="admin_password_reset",
    )


@router.get("", response_model=list[UserListResponse])
async def list_users(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(
        # members.view ("View member list") is the baseline grant every default
        # position carries — this is the member directory, and RPT-3 already
        # settled members.view as the roster-read permission for reports.
        require_permission("users.view", "members.view", "members.manage")
    ),
):
    """
    List all members in the organization

    Contact information (email, phone, mobile) will be included only if:
    1. The organization has enabled contact info visibility in settings
    2. The specific fields (email, phone, mobile) are enabled

    A privacy notice should be displayed when contact information is shown,
    stating that it is for department purposes only and should not be used
    for commercial purposes.

    **Authentication required**

    **Permissions required:** members.manage, members.view, or users.view
    """
    user_service = UserService(db)
    org_service = OrganizationService(db)

    # Get organization settings — if this fails, still return users without
    # contact info rather than returning a 500 that hides the member list.
    include_contact_info = False
    contact_settings = None
    try:
        org_settings = await org_service.get_organization_settings(
            current_user.organization_id
        )
        include_contact_info = org_settings.contact_info_visibility.enabled
        contact_settings = {
            "contact_info_visibility": {
                "show_email": org_settings.contact_info_visibility.show_email,
                "show_phone": org_settings.contact_info_visibility.show_phone,
                "show_mobile": org_settings.contact_info_visibility.show_mobile,
            }
        }
    except Exception as e:
        logger.warning(
            f"Failed to load organization settings, returning users without contact info: {e}"
        )

    # Get users with conditional contact info
    users = await user_service.get_users_for_organization(
        organization_id=current_user.organization_id,
        include_contact_info=include_contact_info,
        contact_settings=contact_settings,
    )

    return users


@router.post(
    "", response_model=UserWithRolesResponse, status_code=status.HTTP_201_CREATED
)
async def create_member(
    user_data: AdminUserCreate,
    background_tasks: BackgroundTasks,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("users.create")),
):
    """
    Create a new member (Secretary/Admin only)

    Allows secretaries and admins to create new member accounts with initial roles.
    A temporary password will be generated and sent via email if send_welcome_email is True.

    **Authentication required**

    **Permissions required:** users.create
    """
    from uuid import uuid4

    from app.core.security import generate_temporary_password, hash_password

    # Check if username already exists
    result = await db.execute(
        select(User)
        .where(User.username == user_data.username)
        .where(User.organization_id == str(current_user.organization_id))
        .where(User.deleted_at.is_(None))
    )
    if result.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Username already exists"
        )

    # Check if membership number already exists in the organization
    if user_data.membership_number:
        result = await db.execute(
            select(User)
            .where(User.membership_number == user_data.membership_number)
            .where(User.organization_id == str(current_user.organization_id))
            .where(User.deleted_at.is_(None))
        )
        if result.scalar_one_or_none():
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="A member with this membership number already exists",
            )

    # Check if email already exists (including archived members)
    result = await db.execute(
        select(User)
        .where(User.email == user_data.email)
        .where(User.organization_id == str(current_user.organization_id))
        .where(User.deleted_at.is_(None))
    )
    existing_user = result.scalar_one_or_none()
    if existing_user:
        if existing_user.status == UserStatus.ARCHIVED:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={
                    "message": (
                        f"An archived member with this email already exists: "
                        f"{existing_user.full_name}. Use the reactivation endpoint "
                        f"to restore their account instead of creating a duplicate."
                    ),
                    "existing_user_id": str(existing_user.id),
                    "existing_member_name": existing_user.full_name,
                    "existing_status": existing_user.status.value,
                    "reactivate_url": f"/api/v1/users/{existing_user.id}/reactivate",
                },
            )
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Email already exists"
        )

    # Use admin-provided password or generate a temporary one
    if user_data.password:
        from app.core.breached_password import check_password_not_breached
        from app.core.security import validate_password_strength

        is_valid, error_msg = validate_password_strength(user_data.password)
        if not is_valid:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=error_msg,
            )

        is_valid, error_msg = await check_password_not_breached(user_data.password)
        if not is_valid:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=error_msg,
            )
        initial_password = user_data.password
        password_hash = hash_password(initial_password)
    else:
        initial_password = generate_temporary_password()
        password_hash = hash_password(initial_password)

    # A rank grants its default permissions (see _collect_user_permissions), so
    # a client-chosen rank must clear the same ceiling as a granted role — a
    # bare users.create/members.manage holder must not mint a member at a rank
    # that outranks their own permissions.
    canonical_rank = await _canonical_rank_or_400(
        user_data.rank, str(current_user.organization_id), db
    )
    await _enforce_rank_grant_ceiling(
        current_user, canonical_rank, db, get_client_ip(request)
    )
    _refuse_administrative_rank(user_data.member_class, None, canonical_rank)

    # Auto-generate membership number if not provided and auto-generation is on
    membership_number = user_data.membership_number
    if not membership_number:
        from app.services.organization_service import OrganizationService

        org_service = OrganizationService(db)
        membership_number = await org_service.generate_next_membership_id(
            current_user.organization_id
        )

    # Resolve and ceiling-check the requested roles BEFORE the user row is
    # created. A denied ceiling check reports a CRITICAL alert via
    # report_privilege_escalation_attempt, which commits the transaction so
    # the alert survives the 403 about to be raised — if that ran after
    # db.add(new_user)/flush() below, the commit would also persist the
    # should-be-rejected user, leaving a live, ACTIVE, password-set account
    # with no roles behind a request the caller believes failed outright.
    roles: list[Role] = []
    if user_data.role_ids:
        # Verify all role IDs exist and belong to the organization
        result = await db.execute(
            select(Role)
            .where(Role.id.in_([str(rid) for rid in user_data.role_ids]))
            .where(Role.organization_id == str(current_user.organization_id))
        )
        roles = result.scalars().all()

        if len(roles) != len(user_data.role_ids):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="One or more role IDs are invalid",
            )

        # Same privilege ceiling the assign/add-role paths enforce: a caller may
        # only grant roles whose permissions are a subset of their own. Without
        # this, a plain `users.create` holder could create an account, set its
        # password, attach a wildcard/"System Owner" role, and log in as it —
        # full-tenant escalation through the create path instead of the (already
        # guarded) assign path.
        await _enforce_role_grant_ceiling(
            current_user, list(roles), db, get_client_ip(request)
        )

    # Create new user
    new_user = User(
        id=str(uuid4()),
        organization_id=current_user.organization_id,
        username=user_data.username,
        email=user_data.email,
        password_hash=password_hash,
        first_name=user_data.first_name,
        middle_name=user_data.middle_name,
        last_name=user_data.last_name,
        membership_number=membership_number,
        phone=user_data.phone,
        mobile=user_data.mobile,
        date_of_birth=user_data.date_of_birth,
        hire_date=user_data.hire_date,
        # Department info
        # Canonical spelling, not the caller's — see _canonical_rank_or_400.
        rank=canonical_rank,
        station=user_data.station,
        platoon=user_data.platoon,
        # Address
        address_street=user_data.address_street,
        address_city=user_data.address_city,
        address_state=user_data.address_state,
        address_zip=user_data.address_zip,
        address_country=user_data.address_country,
        # Emergency contacts (stored as JSON)
        emergency_contacts=[ec.model_dump() for ec in user_data.emergency_contacts],
        email_verified=False,
        status=UserStatus.ACTIVE,
        must_change_password=True,
        password_changed_at=datetime.now(timezone.utc),
    )

    # Set only when the caller asked for one. `_reconcile_membership` treats any
    # assignment to either column as "the caller wrote the new pair" and then
    # derives `membership_type` from it, so writing a bare None here would claim
    # authorship of a standing nobody stated and pin every new member to the
    # default pair — the opposite of the omit-and-derive path the listener
    # documents. The listener fills whichever half is missing.
    if user_data.member_class or user_data.member_status:
        new_user.member_class = user_data.member_class
        new_user.member_status = user_data.member_status

    db.add(new_user)
    await db.flush()  # Flush to get the user ID

    # Assign initial roles if provided (already resolved and ceiling-checked
    # above, before this user row existed).
    if user_data.role_ids:
        for role in roles:
            await db.execute(
                user_roles.insert().values(
                    user_id=new_user.id,
                    position_id=role.id,
                    assigned_by=current_user.id,
                )
            )

    # Ensure the default "member" role is always assigned for baseline permissions
    assigned_role_slugs = {r.slug for r in roles} if user_data.role_ids else set()
    if ROLE_MEMBER not in assigned_role_slugs:
        member_result = await db.execute(
            select(Role).where(
                Role.organization_id == str(current_user.organization_id),
                Role.slug == ROLE_MEMBER,
            )
        )
        member_role = member_result.scalar_one_or_none()
        if member_role:
            await db.execute(
                user_roles.insert().values(
                    user_id=new_user.id,
                    position_id=member_role.id,
                    assigned_by=current_user.id,
                )
            )

    # Capture assigned role IDs before commit expires the relationship
    assigned_role_ids = [str(r.id) for r in roles] if user_data.role_ids else []

    await db.commit()

    # Re-query with eager loading so Pydantic can serialize roles without lazy loading
    result = await db.execute(
        select(User).where(User.id == new_user.id).options(selectinload(User.positions))
    )
    new_user = result.scalar_one_or_none()
    if not new_user:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="User disappeared after creation",
        )

    await log_audit_event(
        db=db,
        event_type="user_created",
        event_category="user_management",
        severity="info",
        event_data={
            "new_user_id": str(new_user.id),
            "username": new_user.username,
            "email": new_user.email,
            "roles_assigned": assigned_role_ids,
        },
        user_id=str(current_user.id),
        username=current_user.username,
    )

    # Send welcome email with temporary password via background task
    if user_data.send_welcome_email:
        from app.models.user import Organization as OrgModel
        from app.services.email_service import EmailService

        logger.info(f"Welcome email requested for new user: {user_data.username}")

        # Load organization for email config
        org_result = await db.execute(
            select(OrgModel).where(OrgModel.id == str(current_user.organization_id))
        )
        organization = org_result.scalar_one_or_none()

        org_name = organization.name if organization else "The Logbook"
        login_url = (
            f"{settings.FRONTEND_URL}/login"
            if hasattr(settings, "FRONTEND_URL") and settings.FRONTEND_URL
            else "/login"
        )

        # Capture scalar values before they expire after the response returns.
        # The background task runs after this request's DB session has closed, so
        # it must open its own session and reload the org rather than reuse the
        # request `db` or the detached `organization` ORM object.
        welcome_email = new_user.email
        welcome_first = new_user.first_name
        welcome_last = new_user.last_name
        welcome_username = new_user.username
        welcome_org_id = str(current_user.organization_id)

        async def _send_welcome():
            try:
                async for session in database_manager.get_session():
                    org = (
                        await session.execute(
                            select(OrgModel).where(OrgModel.id == welcome_org_id)
                        )
                    ).scalar_one_or_none()
                    email_svc = EmailService(org)
                    await email_svc.send_welcome_email(
                        to_email=welcome_email,
                        first_name=welcome_first,
                        last_name=welcome_last,
                        username=welcome_username,
                        temp_password=initial_password,
                        organization_name=org_name,
                        login_url=login_url,
                        db=session,
                        organization_id=welcome_org_id,
                    )
            except Exception as e:
                logger.error(f"Failed to send welcome email to {welcome_email}: {e}")

        background_tasks.add_task(_send_welcome)

    # Build response — temporary passwords are communicated only via the
    # welcome email, never in API responses (prevents caching/logging leaks).
    response = UserWithRolesResponse.model_validate(new_user)
    return response


@router.get("/contact-info-enabled")
async def check_contact_info_enabled(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Check if contact information display is enabled for the organization

    This endpoint can be used by the frontend to determine whether to show
    the privacy notice and contact information fields.

    **Authentication required**
    """
    org_service = OrganizationService(db)
    settings = await org_service.get_organization_settings(current_user.organization_id)

    return {
        "enabled": settings.contact_info_visibility.enabled,
        "show_email": settings.contact_info_visibility.show_email,
        "show_phone": settings.contact_info_visibility.show_phone,
        "show_mobile": settings.contact_info_visibility.show_mobile,
    }


async def _load_contact_visibility(
    db: AsyncSession, current_user: User, is_admin: bool
) -> dict[str, bool]:
    """Read the org's contact_info_visibility flags for an unprivileged caller.

    Returns an empty mapping — i.e. show nothing — for admins (who bypass
    redaction anyway) and whenever the settings row cannot be read. Failing
    closed matters here: an unreadable settings row must hide contact details,
    not reveal them.
    """
    if is_admin:
        return {}

    org_service = OrganizationService(db)
    try:
        org_settings = await org_service.get_organization_settings(
            current_user.organization_id
        )
        contact = org_settings.contact_info_visibility
        if not contact.enabled:
            return {}
        return {
            "show_email": contact.show_email,
            "show_phone": contact.show_phone,
            "show_mobile": contact.show_mobile,
        }
    except Exception as e:
        logger.warning(
            f"Failed to load contact visibility settings, redacting contact "
            f"info for user {current_user.id}: {e}"
        )
        return {}


def _clear_leadership_only_fields(
    payload: UserWithRolesResponse | UserProfileResponse,
) -> None:
    """Blank, in place, the fields restricted to leadership.

    Date of birth and emergency contacts are a different category from the rest
    of the contact block, and are handled separately for that reason:

    * `contact_info_visibility` deliberately has no flag for them. They are not
      roster data a department may choose to publish — they are leadership-only
      unconditionally, so there is no configuration that discloses them.
    * Emergency contacts are PII belonging to people who are not members of the
      department at all — a member's spouse or parent, by name and phone. They
      never consented to appear in the roster, and cannot remove themselves.
    * Date of birth is identity-theft-grade and is the field most often paired
      with a name to impersonate someone.

    Cleared for everyone except `members.manage` holders and the member
    themselves; both exemptions are applied by the callers, which return early
    before reaching this.
    """
    payload.date_of_birth = None
    payload.emergency_contacts = []


def _clear_directory_only_profile_metadata(payload: UserProfileResponse) -> None:
    """Remove account and authorization metadata from a directory profile.

    ``members.view`` allows a member to find and open a colleague's directory
    entry.  It must not also reveal the colleague's account-security state,
    notification settings, or the permission sets attached to their roles.
    Role names remain available because they are displayed on the profile.
    """
    payload.email_verified = None
    payload.mfa_enabled = None
    payload.last_login_at = None
    payload.created_at = None
    payload.updated_at = None
    payload.notification_preferences = None
    for role in payload.roles:
        role.permissions = []


def _clear_hidden_contact_fields(
    payload: UserWithRolesResponse | UserProfileResponse, visibility: dict[str, bool]
) -> None:
    """Blank, in place, the contact details an unprivileged caller may not see.

    Shared by the roster and the single-member profile so the two cannot drift:
    ORU-8 was exactly that drift — the roster redacted, the detail endpoint
    returned the same columns untouched, and a member refused an email address
    on the roster could read it (plus personal_email and the home address) by
    requesting the detail URL instead.
    """
    if not visibility.get("show_email", False):
        payload.email = None
    if not visibility.get("show_phone", False):
        payload.phone = None
    if not visibility.get("show_mobile", False):
        payload.mobile = None

    # Never surfaced to the general membership at any visibility setting, so the
    # setting has no "show" flag for them — they are admin-only by definition.
    payload.personal_email = None
    payload.address_street = None
    payload.address_city = None
    payload.address_state = None
    payload.address_zip = None
    payload.address_country = None


def _redact_contact_fields(
    user: User, visibility: dict[str, bool], is_admin: bool
) -> UserWithRolesResponse:
    """Blank out contact details the caller is not entitled to see.

    Builds the response from the ORM object then clears fields, rather than
    filtering at query time, so a future column added to the schema is visible
    by default and has to be considered here — the reverse (an allow-list that
    silently drops new fields) hides bugs instead of surfacing them.

    Members-managers keep everything: they are the people who maintain these
    records, and the visibility setting exists to control what the *roster*
    shows the general membership.
    """
    payload = UserWithRolesResponse.model_validate(user)
    if is_admin:
        return payload

    _clear_hidden_contact_fields(payload, visibility)
    _clear_leadership_only_fields(payload)
    return payload


@router.get("/with-roles", response_model=list[UserWithRolesResponse])
async def list_users_with_roles(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("users.view", "members.manage")),
):
    """
    List all users with their assigned roles

    This endpoint is for the Members admin page.

    Contact information is redacted the same way `GET /users` redacts it —
    see the note in the implementation.

    **Authentication required**

    **Permissions required:** members.manage or users.view
    """
    is_admin = _has_permission(
        "members.manage", _collect_user_permissions(current_user)
    )
    visibility = await _load_contact_visibility(db, current_user, is_admin)

    result = await db.execute(
        select(User)
        .where(User.organization_id == str(current_user.organization_id))
        .where(User.deleted_at.is_(None))
        .options(selectinload(User.roles))
        .order_by(User.last_name, User.first_name)
    )
    users = result.scalars().all()

    # SEC (ORU-8): this endpoint returned every field on the model, while
    # `GET /users` filtered contact details against the organization's
    # contact_info_visibility setting. Both are reachable with plain
    # `users.view`, so a member who was refused an email address on the roster
    # could read it — plus home address and personal email, which the roster
    # never exposes at all — by requesting this URL instead. Redact here too,
    # or the setting is advisory.
    return [_redact_contact_fields(user, visibility, is_admin) for user in users]


@router.get("/{user_id}/roles", response_model=UserRoleResponse)
async def get_user_roles(
    user_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("users.view", "members.manage")),
):
    """
    Get roles assigned to a specific user

    **Authentication required**

    **Permissions required:** members.manage or users.view
    """
    result = await db.execute(
        select(User)
        .where(User.id == str(user_id))
        .where(User.organization_id == str(current_user.organization_id))
        .where(User.deleted_at.is_(None))
        .options(selectinload(User.roles))
    )
    user = result.scalar_one_or_none()

    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="User not found"
        )

    return {
        "user_id": user.id,
        "username": user.username,
        "full_name": user.full_name,
        "roles": user.roles,
    }


async def _enforce_role_grant_ceiling(
    current_user: User,
    roles: list[Role],
    db: AsyncSession,
    ip_address: str | None,
) -> None:
    """Prevent privilege escalation through role assignment.

    A caller may only grant a role whose permissions are a subset of their own
    effective permissions. Without this ceiling, any holder of a role-management
    permission (e.g. secretary) could assign themselves — or anyone — a wildcard
    ("*") "System Owner" role and escalate to full control of the tenant.

    Wildcards are honored via ``permission_matches``: a caller holding
    ``settings.*`` may grant ``settings.edit``, and only a holder of ``*`` may
    grant a role that itself contains ``*``.

    A blocked attempt is reported to security monitoring (a CRITICAL alert), so
    a user probing for an escalation path is visible even though it's denied.
    """
    caller_perms = _collect_user_permissions(current_user)
    for role in roles:
        for perm in role.permissions or []:
            if not _has_permission(perm, caller_perms):
                await report_privilege_escalation_attempt(
                    db, str(current_user.id), f"role:{role.id}", ip_address
                )
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail=(
                        "You cannot assign a role that grants permissions "
                        "beyond your own."
                    ),
                )


async def _canonical_rank_or_400(
    rank: Optional[str], organization_id: str, db: AsyncSession
) -> Optional[str]:
    """Refuse a rank the organization does not have; return the one it does.

    ``User.rank`` is a plain ``String(100)`` with no foreign key, so until now
    any string at all could be stored — and a typo does not fail loudly. It
    resolves to no eligible seats and no default permissions, so the member
    silently cannot sign up for anything, which reads as the application being
    broken rather than as a mistyped rank.

    The codebase already knew: ``OperationalRankService.validate_ranks``
    exists to *report* members whose stored rank matches no configured one.
    This asks the same question one step earlier, where it can still be
    answered by refusing the write.

    **Callers must store the value this returns, not the one they passed in.**
    Checking a normalized string and then persisting the caller's original
    re-creates the exact failure being guarded against — ``" firefighter "``
    would clear the check and then match no dictionary key downstream, leaving
    the member with no permissions and no seats.

    Clearing a rank stays allowed — an empty value is "no rank", not a bad one
    — and comes back as ``None`` so the caller writes the cleared value.
    """
    if rank is None or not str(rank).strip():
        return None
    service = OperationalRankService(db)
    canonical = await service.resolve_rank_code(organization_id, str(rank))
    if canonical is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=rank_not_configured_message(str(rank)),
        )
    return canonical


async def _enforce_rank_grant_ceiling(
    current_user: User,
    rank: str | None,
    db: AsyncSession,
    ip_address: str | None,
) -> None:
    """Prevent privilege escalation through the operational rank.

    A member's rank contributes to their effective permissions
    (``_collect_user_permissions`` unions each rank's default permissions), so
    setting a rank grants those permissions exactly as assigning a role does.
    Rank changes are otherwise gated only on ``members.manage`` — so without
    this ceiling a secretary (who holds ``members.manage`` but not
    ``settings.manage``/``security.manage``) could set ``rank="fire_chief"`` on
    a new member (with a chosen password) or on themselves and escalate to
    tenant admin through a parallel, previously-unguarded permission source.
    The same subset rule and wildcard handling as the role ceiling apply.
    """
    if not rank:
        return
    caller_perms = _collect_user_permissions(current_user)
    for perm in get_rank_default_permissions(rank):
        if not _has_permission(perm, caller_perms):
            await report_privilege_escalation_attempt(
                db, str(current_user.id), f"rank:{rank}", ip_address
            )
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=(
                    "You cannot assign a rank that grants permissions "
                    "beyond your own."
                ),
            )


def _refuse_administrative_rank(
    member_class: str | None,
    membership_type: str | None,
    rank: str | None,
) -> None:
    """Refuse a write that makes somebody an administrative member *with* a rank.

    A rank is not decoration: ``_collect_user_permissions`` unions
    ``get_rank_default_permissions(user.rank)`` into a member's effective
    permissions, so an administrative member carrying ``fire_chief`` holds
    ``settings.manage``/``security.manage`` through the operational chain of
    command they are by definition outside of.

    Only the contradictory *pair* is refused. A class change that merely strands
    an existing rank clears it instead (see the callers) — the operator is not
    asserting the rank there, so refusing would make them do two saves for one
    decision.
    """
    if rank and is_administrative(member_class, membership_type):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=ADMINISTRATIVE_RANK_MESSAGE,
        )


async def _enforce_account_reset_ceiling(
    current_user: User,
    target_user: User,
    db: AsyncSession,
) -> None:
    """Prevent account resets from becoming a privilege-escalation path.

    Member managers may assist users whose effective permissions are within
    their own permission ceiling, but may not reset credentials or MFA for a
    user who has permissions they do not possess.
    """
    caller_perms = _collect_user_permissions(current_user)
    target_perms = _collect_user_permissions(target_user)
    if any(not _has_permission(perm, caller_perms) for perm in target_perms):
        await report_privilege_escalation_attempt(
            db, str(current_user.id), f"account-reset:{target_user.id}", None
        )
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You cannot reset the account of a user with privileges beyond your own.",
        )


@router.put("/{user_id}/roles", response_model=UserRoleResponse)
async def assign_user_roles(
    user_id: UUID,
    role_assignment: UserRoleAssignment,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(
        require_permission(
            "users.update_positions",
            "members.assign_positions",
            "users.update_roles",
            "members.assign_roles",
        )
    ),
):
    """
    Assign roles to a user (replaces all existing roles)

    **Authentication required**

    **Permissions required:** members.assign_positions, members.assign_roles,
    users.update_positions, or users.update_roles
    """
    # Get user
    result = await db.execute(
        select(User)
        .where(User.id == str(user_id))
        .where(User.organization_id == str(current_user.organization_id))
        .where(User.deleted_at.is_(None))
        .options(selectinload(User.roles))
    )
    user = result.scalar_one_or_none()

    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="User not found"
        )

    # Verify all role IDs exist and belong to the same organization
    if role_assignment.role_ids:
        result = await db.execute(
            select(Role)
            .where(Role.id.in_([str(rid) for rid in role_assignment.role_ids]))
            .where(Role.organization_id == str(current_user.organization_id))
        )
        roles = result.scalars().all()

        if len(roles) != len(role_assignment.role_ids):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="One or more role IDs are invalid",
            )
    else:
        roles = []

    # Prevent privilege escalation: the caller cannot grant a role that exceeds
    # their own permissions (e.g. assigning a wildcard "System Owner" role).
    await _enforce_role_grant_ceiling(
        current_user, list(roles), db, get_client_ip(request)
    )

    # The escalation ceiling above only guards *raising* permissions. This call
    # replaces the user's entire position set — including with an empty list —
    # so it is also the cheapest way to strip the last administrator.
    resulting_permissions: set[str] = set()
    for role in roles:
        resulting_permissions.update(role.permissions or [])
    if user.rank:
        resulting_permissions.update(get_rank_default_permissions(user.rank))
    try:
        await assert_positions_retain_administrator(
            db,
            str(current_user.organization_id),
            user_id,
            resulting_permissions,
            action="remove administrator positions from",
        )
    except LastAdministratorError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

    # Assigning the collection is what replaces the assignments: SQLAlchemy
    # diffs it against the eagerly loaded one above and emits exactly the
    # needed user_positions inserts and deletes. Clearing the table by hand
    # first would both hide the retained positions from that diff (so their
    # rows would never be re-inserted) and leave the loaded collection stale,
    # making the delete of a dropped position raise StaleDataError.
    user.roles = roles
    await db.commit()

    # Re-query with eager loading to avoid MissingGreenlet on serialization
    result = await db.execute(
        select(User)
        .where(User.id == str(user_id))
        .options(selectinload(User.positions))
    )
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found after role assignment",
        )

    await log_audit_event(
        db=db,
        event_type="user_role_assigned",
        event_category="user_management",
        severity="info",
        event_data={
            "target_user_id": str(user_id),
            "role_ids": [str(r) for r in role_assignment.role_ids],
            "action": "roles_replaced",
        },
        user_id=str(current_user.id),
        username=current_user.username,
    )

    return {
        "user_id": user.id,
        "username": user.username,
        "full_name": user.full_name,
        "roles": user.roles,
    }


@router.post("/{user_id}/roles/{role_id}", response_model=UserRoleResponse)
async def add_role_to_user(
    user_id: UUID,
    role_id: UUID,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(
        require_permission(
            "users.update_positions",
            "members.assign_positions",
            "users.update_roles",
            "members.assign_roles",
        )
    ),
):
    """
    Add a single role to a user (keeps existing roles)

    **Authentication required**

    **Permissions required:** members.assign_positions, members.assign_roles,
    users.update_positions, or users.update_roles
    """
    # Get user
    result = await db.execute(
        select(User)
        .where(User.id == str(user_id))
        .where(User.organization_id == str(current_user.organization_id))
        .where(User.deleted_at.is_(None))
        .options(selectinload(User.roles))
    )
    user = result.scalar_one_or_none()

    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="User not found"
        )

    # Get role
    result = await db.execute(
        select(Role)
        .where(Role.id == str(role_id))
        .where(Role.organization_id == str(current_user.organization_id))
    )
    role = result.scalar_one_or_none()

    if not role:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Role not found"
        )

    # Check if user already has this role
    if role in user.roles:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="User already has this role"
        )

    # Prevent privilege escalation: the caller cannot grant a role that exceeds
    # their own permissions (e.g. assigning a wildcard "System Owner" role).
    await _enforce_role_grant_ceiling(current_user, [role], db, get_client_ip(request))

    # Capture role name before commit expires the ORM object
    added_role_name = role.name

    # Add role
    user.roles.append(role)
    await db.commit()

    # Re-query with eager loading to avoid MissingGreenlet on serialization
    result = await db.execute(
        select(User)
        .where(User.id == str(user_id))
        .options(selectinload(User.positions))
    )
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found after role addition",
        )

    await log_audit_event(
        db=db,
        event_type="user_role_assigned",
        event_category="user_management",
        severity="info",
        event_data={
            "target_user_id": str(user_id),
            "role_id": str(role_id),
            "role_name": added_role_name,
            "action": "role_added",
        },
        user_id=str(current_user.id),
        username=current_user.username,
    )

    return {
        "user_id": user.id,
        "username": user.username,
        "full_name": user.full_name,
        "roles": user.roles,
    }


@router.delete("/{user_id}/roles/{role_id}", response_model=UserRoleResponse)
async def remove_role_from_user(
    user_id: UUID,
    role_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(
        require_permission(
            "users.update_positions",
            "members.assign_positions",
            "users.update_roles",
            "members.assign_roles",
        )
    ),
):
    """
    Remove a role from a user

    **Authentication required**

    **Permissions required:** members.assign_positions, members.assign_roles,
    users.update_positions, or users.update_roles
    """
    # Get user
    result = await db.execute(
        select(User)
        .where(User.id == str(user_id))
        .where(User.organization_id == str(current_user.organization_id))
        .where(User.deleted_at.is_(None))
        .options(selectinload(User.roles))
    )
    user = result.scalar_one_or_none()

    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="User not found"
        )

    # Find and remove role (cast to str since role.id is String, role_id is UUID)
    role_to_remove = None
    for role in user.roles:
        if str(role.id) == str(role_id):
            role_to_remove = role
            break

    if not role_to_remove:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="User does not have this role"
        )

    resulting_permissions: set[str] = set()
    for role in user.roles:
        if str(role.id) != str(role_id):
            resulting_permissions.update(role.permissions or [])
    if user.rank:
        resulting_permissions.update(get_rank_default_permissions(user.rank))
    try:
        await assert_positions_retain_administrator(
            db,
            str(current_user.organization_id),
            user_id,
            resulting_permissions,
            action="remove the last administrator position from",
        )
    except LastAdministratorError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

    role_removed_name = role_to_remove.name
    user.roles.remove(role_to_remove)
    await db.commit()

    # Re-query with eager loading to avoid MissingGreenlet on serialization
    result = await db.execute(
        select(User)
        .where(User.id == str(user_id))
        .options(selectinload(User.positions))
    )
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found after role removal",
        )

    await log_audit_event(
        db=db,
        event_type="user_role_removed",
        event_category="user_management",
        severity="info",
        event_data={
            "target_user_id": str(user_id),
            "role_id": str(role_id),
            "role_name": role_removed_name,
            "action": "role_removed",
        },
        user_id=str(current_user.id),
        username=current_user.username,
    )

    return {
        "user_id": user.id,
        "username": user.username,
        "full_name": user.full_name,
        "roles": user.roles,
    }


@router.get("/{user_id}/with-roles", response_model=UserProfileResponse)
async def get_user_with_roles(
    user_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Get a specific user with their assigned roles and notification preferences

    This endpoint is for the member profile page and digital ID card.
    Users can always view their own record; viewing another member's record
    requires `users.view`, `members.view`, or `members.manage` — members.view
    is the directory permission every default position carries, so any
    department member can open a colleague's (redacted) profile.

    Contact information is redacted against the organization's
    `contact_info_visibility` setting exactly as `GET /users/with-roles` does —
    see `_clear_hidden_contact_fields`. Date of birth and emergency contacts are
    leadership-only regardless of that setting — see
    `_clear_leadership_only_fields`. A caller relying only on `members.view`
    also receives no account-security, notification, or role-permission
    metadata. Members-managers and the subject themselves are exempt.

    **Authentication required**
    """
    user_permissions = _collect_user_permissions(current_user)
    is_self = str(current_user.id) == str(user_id)

    # Self-access needs no permission grant: MemberIdCardPage, MemberProfilePage
    # and UserSettingsPage all load the caller's own record through here, and a
    # user can be stripped of every position without losing their own record.
    # For other members' records, members.view (the directory permission) is
    # enough — the redaction below withholds contact info per org settings and
    # keeps DOB/emergency contacts leadership-only, so the profile a plain
    # member sees matches what the roster already shows them.
    if not is_self and not (
        _has_permission("users.view", user_permissions)
        or _has_permission("members.view", user_permissions)
        or _has_permission("members.manage", user_permissions)
    ):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Insufficient permissions"
        )

    result = await db.execute(
        select(User)
        .where(User.id == str(user_id))
        .where(User.organization_id == str(current_user.organization_id))
        .where(User.deleted_at.is_(None))
        .options(selectinload(User.roles))
    )
    user = result.scalar_one_or_none()

    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="User not found"
        )

    is_admin = _has_permission("members.manage", user_permissions)
    # Leadership reading someone else's record is the access worth being able
    # to reconstruct later: it is the only path that discloses another member's
    # date of birth and their family's names and phone numbers. Recorded on the
    # event so the audit trail answers "who saw it", not merely "who looked".
    discloses_restricted_pii = is_admin and not is_self

    await log_audit_event(
        db=db,
        event_type="user_viewed",
        event_category="user_management",
        severity="info",
        event_data={
            "viewed_user_id": str(user_id),
            "viewed_username": user.username,
            "restricted_pii_disclosed": discloses_restricted_pii,
        },
        user_id=str(current_user.id),
        username=current_user.username,
    )

    # SEC (ORU-8): redact on the same terms as the roster. Without this the
    # visibility setting is advisory — anything the roster withheld is one
    # request to this URL away. The subject is exempt: UserSettingsPage loads
    # its own profile through here and writes the fields back, so redacting for
    # self would blank a member's own address and phone on their next save.
    payload = UserProfileResponse.model_validate(user)
    if not (is_admin or is_self):
        visibility = await _load_contact_visibility(db, current_user, is_admin)
        _clear_hidden_contact_fields(payload, visibility)
        _clear_leadership_only_fields(payload)
        if not _has_permission("users.view", user_permissions):
            _clear_directory_only_profile_metadata(payload)

    return payload


@router.patch("/{user_id}/contact-info", response_model=UserProfileResponse)
async def update_contact_info(
    user_id: UUID,
    contact_update: ContactInfoUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Update user contact information and notification preferences

    Users can only update their own contact information unless they have admin permissions.

    **Authentication required**
    """
    # Check if user is updating their own profile or has admin permissions
    if current_user.id != str(user_id):
        # Admins with users.edit or members.manage can update other users
        user_perms = _collect_user_permissions(current_user)
        if not _has_permission("users.edit", user_perms) and not _has_permission(
            "members.manage", user_perms
        ):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You can only update your own contact information",
            )

    result = await db.execute(
        select(User)
        .where(User.id == str(user_id))
        .where(User.organization_id == str(current_user.organization_id))
        .where(User.deleted_at.is_(None))
        .options(selectinload(User.roles))
    )
    user = result.scalar_one_or_none()

    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="User not found"
        )

    # Update fields if provided
    if contact_update.email is not None:
        # Check if email is already in use by another user in the organization
        existing = await db.execute(
            select(User)
            .where(User.email == contact_update.email)
            .where(User.organization_id == str(current_user.organization_id))
            # User.id is a String column; user_id is a UUID — compare as strings
            # so the caller's own row is actually excluded (a UUID-vs-str compare
            # never matches, producing a spurious "already in use" on self-save).
            .where(User.id != str(user_id))
            .where(User.deleted_at.is_(None))
        )
        if existing.scalar_one_or_none():
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Email is already in use",
            )
        # A changed email is no longer proven to belong to the user; drop the
        # verified flag so it must be re-verified rather than inheriting trust.
        if contact_update.email != user.email:
            user.email_verified = False
        user.email = contact_update.email

    if contact_update.phone is not None:
        user.phone = contact_update.phone

    if contact_update.mobile is not None:
        user.mobile = contact_update.mobile

    if contact_update.notification_preferences is not None:
        # Merge, never replace. Every field on NotificationPreferences defaults
        # to True, so dumping the whole model turned a partial payload into a
        # re-subscribe: a caller sending only {"sms_notifications": false}
        # silently switched the member's other preferences back on, and the
        # 200 made it look like the save had done exactly what was asked.
        # An omitted key means "leave this alone" (CLAUDE.md pitfall 1b).
        known_keys = set(NotificationPreferences.model_fields)
        merged = {
            key: value
            for key, value in (user.notification_preferences or {}).items()
            # Drops keys no sender reads any more, so a blob that predates
            # migration 20260816_0007 heals on its next save instead of
            # carrying a dead `email` flag forever.
            if key in known_keys
        }
        merged.update(
            contact_update.notification_preferences.model_dump(exclude_unset=True)
        )
        # Every value is a flat bool, so this rebuilt dict is a genuinely new
        # value and SQLAlchemy issues the UPDATE. Pitfall 12 (shallow copies
        # sharing nested references) does not arise — there is no nesting.
        user.notification_preferences = merged

    await db.commit()

    # Re-query with eager loading to avoid MissingGreenlet on serialization
    result = await db.execute(
        select(User)
        .where(User.id == str(user_id))
        .options(selectinload(User.positions))
    )
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found after contact update",
        )

    await log_audit_event(
        db=db,
        event_type="user_updated",
        event_category="user_management",
        severity="info",
        event_data={
            "updated_user_id": str(user_id),
            "fields_updated": list(
                contact_update.model_dump(exclude_unset=True).keys()
            ),
        },
        user_id=str(current_user.id),
        username=current_user.username,
    )

    return user


@router.patch("/{user_id}/profile", response_model=UserProfileResponse)
async def update_user_profile(
    user_id: UUID,
    profile_update: UserUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Update user profile information (name, address, emergency contacts, etc.)

    Users can update their own profile. Admins with users.edit or members.manage
    permission can update any user's profile.

    **Authentication required**
    """
    # Check if user is updating their own profile or has admin permissions
    is_self = str(current_user.id) == str(user_id)
    if not is_self:
        # Eagerly load positions so _collect_user_permissions can iterate safely
        perm_result = await db.execute(
            select(User)
            .where(User.id == current_user.id)
            .options(selectinload(User.positions))
        )
        perm_user = perm_result.scalar_one()
        user_permissions = _collect_user_permissions(perm_user)
        # Use the catalog permission "users.edit" (there is no "users.update"
        # permission, so the old string never matched a granted permission and
        # silently blocked legitimate users.edit holders). Matches the sibling
        # admin-update path above. (ORU-9)
        if not _has_permission("users.edit", user_permissions) and not _has_permission(
            "members.manage", user_permissions
        ):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You do not have permission to update this user's profile",
            )

    # Locked, because "an administrative member holds no operational rank" is a
    # read-then-write and the two halves live in different endpoints. Without
    # this, a request setting a rank and a request setting the class to
    # administrative can both read an operational, rankless member, both pass
    # their own check, and each write only its own column — leaving a row that
    # is administrative *and* ranked, which neither request would have allowed.
    # A locking read for the same reason the capacity checks use one: under
    # REPEATABLE READ a plain SELECT answers from the transaction's first
    # snapshot, so acquiring the lock without re-reading buys nothing.
    result = await db.execute(
        select(User)
        .where(User.id == str(user_id))
        .where(User.organization_id == str(current_user.organization_id))
        .where(User.deleted_at.is_(None))
        .with_for_update()
        .options(selectinload(User.roles))
    )
    user = result.scalar_one_or_none()

    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="User not found"
        )

    # Update only provided fields
    update_data = profile_update.model_dump(exclude_unset=True)

    # Check membership_number uniqueness within the organization
    if "membership_number" in update_data and update_data["membership_number"]:
        existing = await db.execute(
            select(User)
            .where(User.membership_number == update_data["membership_number"])
            .where(User.organization_id == str(current_user.organization_id))
            .where(User.id != str(user_id))
            .where(User.deleted_at.is_(None))
        )
        if existing.scalar_one_or_none():
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="A member with this membership number already exists",
            )

    # Eligibility and assignment fields are restricted to leadership,
    # the secretary, or the membership coordinator. In particular, hire_date
    # drives automatic membership tier advancement and must not be editable
    # with the broader users.edit grant.
    restricted_fields = {
        "hire_date",
        "rank",
        "station",
        "platoon",
        "membership_number",
        # Membership classification decides who is in the operational body and
        # therefore who receives which ballot. Left out of this set, any holder
        # of the broader users.edit grant could move themselves from social or
        # administrative into operational and vote on what they liked.
        "member_class",
        "member_status",
    }
    has_restricted = restricted_fields & update_data.keys()
    if has_restricted:
        perm_result = await db.execute(
            select(User)
            .where(User.id == current_user.id)
            .options(selectinload(User.positions))
        )
        perm_user = perm_result.scalar_one_or_none()
        if not perm_user or not _has_permission(
            "members.manage", _collect_user_permissions(perm_user)
        ):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=(
                    "Only leadership, the secretary, or the membership coordinator "
                    "can update hire date, rank, station, platoon, membership "
                    "number, or membership class and status"
                ),
            )

        # members.manage lets you set rank, but a rank grants its own
        # permissions — so a rank change must also clear the permission-grant
        # ceiling, or a secretary could self-promote to a chief rank and gain
        # settings.manage/security.manage. Only enforced on an actual change.
        if "rank" in update_data:
            update_data["rank"] = await _canonical_rank_or_400(
                update_data["rank"], str(current_user.organization_id), db
            )
            if update_data["rank"] != user.rank:
                await _enforce_rank_grant_ceiling(
                    perm_user, update_data["rank"], db, None
                )

        # An administrative member holds no operational rank. Judge against the
        # class this save *lands on* — the payload's when it sets one, the
        # stored one otherwise — because the two can move in the same request.
        resulting_class = update_data.get("member_class") or user.member_class
        resulting_type = user.membership_type
        if "rank" in update_data:
            _refuse_administrative_rank(
                resulting_class, resulting_type, update_data["rank"]
            )
        elif user.rank and is_administrative(resulting_class, resulting_type):
            # The save moves them to administrative and says nothing about the
            # rank they already carry. Clear it rather than refuse: the operator
            # is not asserting the rank, and leaving it would leave its default
            # permissions live on a member now outside the chain of command.
            update_data["rank"] = None

    # Snapshot for the audit trail before `emergency_contacts` is popped below.
    # Taken from `update_data` rather than the raw payload because a move to the
    # administrative class clears the member's rank without the client having
    # named the field, and a permission-bearing change nobody requested is
    # exactly the kind the trail has to show.
    audited_fields = list(update_data.keys())

    # Handle emergency_contacts separately (needs serialization)
    if "emergency_contacts" in update_data:
        ec_list = update_data.pop("emergency_contacts")
        if ec_list is not None:
            user.emergency_contacts = [
                ec.model_dump() if hasattr(ec, "model_dump") else ec
                for ec in profile_update.emergency_contacts
            ]

    # Allowlist of safe fields to prevent mass-assignment of sensitive columns
    ALLOWED_PROFILE_FIELDS = {
        "first_name",
        "middle_name",
        "last_name",
        "membership_number",
        "phone",
        "mobile",
        "personal_email",
        "date_of_birth",
        "hire_date",
        "rank",
        "station",
        "platoon",
        # Gated above by `restricted_fields`, which exists precisely so these
        # two can be written under `members.manage`. Omitting them here made
        # that gate guard a write the endpoint then discarded: the request was
        # permission-checked, audited and answered 200, and the member's class
        # never changed. `_reconcile_membership` re-derives `membership_type`
        # from whichever of the pair lands.
        "member_class",
        "member_status",
        "address_street",
        "address_city",
        "address_state",
        "address_zip",
        "address_country",
    }
    for field, value in update_data.items():
        if field in ALLOWED_PROFILE_FIELDS and hasattr(user, field):
            setattr(user, field, value)

    await db.commit()

    # Re-query with eager loading to avoid MissingGreenlet on serialization
    result = await db.execute(
        select(User)
        .where(User.id == str(user_id))
        .options(selectinload(User.positions))
    )
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found after profile update",
        )

    await log_audit_event(
        db=db,
        event_type="user_profile_updated",
        event_category="user_management",
        severity="info",
        event_data={
            "updated_user_id": str(user_id),
            "updated_by": str(current_user.id),
            "is_self_update": is_self,
            "fields_updated": audited_fields,
        },
        user_id=str(current_user.id),
        username=current_user.username,
    )

    return user


@router.delete("/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_user(
    user_id: UUID,
    hard: bool = Query(
        False, description="Permanently delete the member and all associated records"
    ),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("members.manage")),
):
    """
    Delete a member. By default this is a soft-delete (sets deleted_at).
    Pass `hard=true` to permanently delete the member and all associated records.

    **Authentication required**

    **Permissions required:** members.manage
    """
    if str(user_id) == str(current_user.id):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You cannot delete your own account",
        )

    # For hard delete, include soft-deleted users too
    query = select(User).where(
        User.id == str(user_id),
        User.organization_id == str(current_user.organization_id),
    )
    if not hard:
        query = query.where(User.deleted_at.is_(None))

    result = await db.execute(query)
    user = result.scalar_one_or_none()

    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found",
        )

    # The self-delete check above stops an admin removing themselves, but not
    # one admin removing the other and only remaining one.
    try:
        await assert_not_last_administrator(
            db,
            str(current_user.organization_id),
            user_id,
            action="delete",
        )
    except LastAdministratorError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

    # Capture values before delete/commit
    deleted_username = user.username
    deleted_full_name = user.full_name

    if hard:
        # Attribution columns that were never given an ondelete (`created_by`,
        # `approved_by`, `issued_by`, ...) are RESTRICT in MySQL, so any member
        # who has ever created a record would otherwise fail the DELETE with
        # errno 1451. Clear the nullable ones; refuse when a record cannot be
        # left ownerless. See user_deletion_service for the full rationale.
        blockers = await find_hard_delete_blockers(db, str(user_id))
        if blockers:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=(
                    "This member owns records that must retain an owner, so they "
                    "cannot be permanently deleted. Deactivate the member instead, "
                    "then anonymize them to remove their personal information while "
                    "keeping those records intact."
                ),
            )

        await release_user_references(db, str(user_id))

        # Deleting the User is also what removes its user_positions rows.
        # Deleting them separately first would leave the User.positions
        # collection — eagerly loaded by the administrator guard above —
        # holding rows that no longer exist, and the flush below would then
        # fail with StaleDataError.
        await db.delete(user)
        try:
            await db.commit()
        except IntegrityError as e:
            # A reference the metadata scan expected MySQL to resolve on its
            # own did not resolve (schema drift from the models). Report it as
            # a conflict rather than a 500; the real constraint is logged.
            await db.rollback()
            logger.error(f"Hard delete of user {user_id} blocked by a reference: {e}")
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=(
                    "This member is still referenced by records that must keep "
                    "an owner, so they cannot be permanently deleted. "
                    "Deactivate the member instead, then anonymize them."
                ),
            )

        await log_audit_event(
            db=db,
            event_type="user_hard_deleted",
            event_category="user_management",
            severity="critical",
            event_data={
                "deleted_user_id": str(user_id),
                "deleted_username": deleted_username,
                "deleted_full_name": deleted_full_name,
                "action": "permanent_deletion",
            },
            user_id=str(current_user.id),
            username=current_user.username,
        )
    else:
        # Preserve membership number so it can be restored on reactivation,
        # then clear it to free the unique index for new members.
        if user.membership_number:
            user.previous_membership_number = user.membership_number
            user.membership_number = None
        user.deleted_at = datetime.now(timezone.utc)
        await db.commit()

        await log_audit_event(
            db=db,
            event_type="user_deleted",
            event_category="user_management",
            severity="warning",
            event_data={
                "deleted_user_id": str(user_id),
                "deleted_username": deleted_username,
                "deleted_full_name": deleted_full_name,
            },
            user_id=str(current_user.id),
            username=current_user.username,
        )


@router.post(
    "/{user_id}/reset-password",
    status_code=status.HTTP_200_OK,
    dependencies=[Depends(_rate_limit_admin_reset)],
)
async def admin_reset_password(
    user_id: UUID,
    reset_data: AdminPasswordReset,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("users.create", "members.manage")),
):
    """
    Reset a user's password (IT Lead / Admin only)

    Allows administrators to set a new password for any member.
    By default the user is required to change the password on next login.

    **Authentication required**

    **Permissions required:** members.manage or users.create
    """
    from app.core.breached_password import check_password_not_breached
    from app.core.security import hash_password, validate_password_strength
    from app.models.user import Session as UserSession
    from app.services.auth_service import _save_password_to_history

    if str(user_id) == str(current_user.id):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Use the change-password endpoint to change your own password",
        )

    result = await db.execute(
        select(User)
        .where(User.id == str(user_id))
        .where(User.organization_id == str(current_user.organization_id))
        .where(User.deleted_at.is_(None))
        .options(selectinload(User.positions))
    )
    user = result.scalar_one_or_none()

    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found",
        )

    await _enforce_account_reset_ceiling(current_user, user, db)

    # Validate the new password
    is_valid, error_msg = validate_password_strength(reset_data.new_password)
    if not is_valid:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=error_msg,
        )

    is_valid, error_msg = await check_password_not_breached(reset_data.new_password)
    if not is_valid:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=error_msg,
        )

    # Capture username before commit
    target_username = user.username

    # Save current password to history before changing (HIPAA §164.312(d))
    if user.password_hash:
        await _save_password_to_history(db, str(user.id), user.password_hash)

    user.password_hash = hash_password(reset_data.new_password)
    user.must_change_password = reset_data.force_change
    user.failed_login_attempts = 0
    user.locked_until = None
    # Only update password_changed_at if user is NOT forced to change password,
    # otherwise the HIPAA minimum password age check would block their required change.
    if not reset_data.force_change:
        user.password_changed_at = datetime.now(timezone.utc)

    # Revoke all existing sessions to force re-login with the new password
    sessions_result = await db.execute(
        select(UserSession).where(UserSession.user_id == str(user_id))
    )
    for session in sessions_result.scalars().all():
        await db.delete(session)

    # Write audit log before commit so it's in the same transaction
    await log_audit_event(
        db=db,
        event_type="admin_password_reset",
        event_category="user_management",
        severity="warning",
        event_data={
            "target_user_id": str(user_id),
            "target_username": target_username,
            "force_change": reset_data.force_change,
        },
        user_id=str(current_user.id),
        username=current_user.username,
    )

    await db.commit()

    return {"message": f"Password has been reset for {target_username}"}


@router.post(
    "/{user_id}/reset-mfa",
    status_code=status.HTTP_200_OK,
    dependencies=[Depends(_rate_limit_admin_reset)],
)
async def admin_reset_mfa(
    user_id: UUID,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("users.create", "members.manage")),
):
    """
    Reset (disable) a user's two-factor authentication (IT Lead / Admin only).

    For members who have lost their authenticator device and exhausted their
    recovery codes. Clears the MFA secret and recovery codes so the member can
    re-enroll from their own Security settings. If the org requires MFA, the
    member is forced back into enrollment on next login.

    Admins cannot reset their own MFA here (they retain their recovery codes or
    can disable it from their own Security settings).

    **Authentication required**

    **Permissions required:** members.manage or users.create
    """
    from app.models.user import Session as UserSession

    if str(user_id) == str(current_user.id):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Use your own Security settings to manage your MFA",
        )

    result = await db.execute(
        select(User)
        .where(User.id == str(user_id))
        .where(User.organization_id == str(current_user.organization_id))
        .where(User.deleted_at.is_(None))
        .options(selectinload(User.positions))
    )
    user = result.scalar_one_or_none()

    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found",
        )

    await _enforce_account_reset_ceiling(current_user, user, db)

    if not user.mfa_enabled:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This user does not have MFA enabled",
        )

    target_username = user.username

    user.mfa_enabled = False
    user.mfa_secret = None
    user.mfa_backup_codes = None

    # Revoke active sessions so the reset takes effect immediately (and the org
    # MFA requirement, if any, re-challenges enrollment on next login).
    sessions_result = await db.execute(
        select(UserSession).where(UserSession.user_id == str(user_id))
    )
    for session in sessions_result.scalars().all():
        await db.delete(session)

    await log_audit_event(
        db=db,
        event_type="admin_mfa_reset",
        event_category="user_management",
        severity="warning",
        event_data={
            "target_user_id": str(user_id),
            "target_username": target_username,
        },
        user_id=str(current_user.id),
        username=current_user.username,
    )

    await notify_security_event(
        db,
        user,
        subject="Your two-factor authentication was reset",
        message=(
            "An administrator reset the two-factor authentication on your "
            "account. You have been signed out. If your organization requires "
            "MFA, you'll be asked to set it up again at your next login."
        ),
        background_tasks=background_tasks,
    )

    await db.commit()

    return {"message": f"MFA has been reset for {target_username}"}


@router.get("/{user_id}/deletion-impact", response_model=DeletionImpactResponse)
async def get_deletion_impact(
    user_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("members.manage")),
):
    """
    Get the impact of deleting a member (how many records would be affected).

    **Authentication required**

    **Permissions required:** members.manage
    """
    result = await db.execute(
        select(User)
        .where(User.id == str(user_id))
        .where(User.organization_id == str(current_user.organization_id))
    )
    user = result.scalar_one_or_none()

    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found",
        )

    # Count training records
    tr_result = await db.execute(
        select(func.count())
        .select_from(TrainingRecordModel)
        .where(TrainingRecordModel.user_id == str(user_id))
    )
    training_count = tr_result.scalar() or 0

    # Count inventory the member is still holding.
    #
    # Individually-tracked gear lives in item_assignments and pool stock in
    # item_issuances; a member typically holds both, and a preview that counts
    # only one of them understates what a permanent delete destroys. Each has
    # its own "still out" column — is_active here, returned_at there — so the
    # two cannot be folded into one query.
    assignment_result = await db.execute(
        select(func.count())
        .select_from(ItemAssignment)
        .where(
            ItemAssignment.user_id == str(user_id),
            ItemAssignment.is_active.is_(True),
        )
    )
    issuance_result = await db.execute(
        select(func.count())
        .select_from(ItemIssuance)
        .where(
            ItemIssuance.user_id == str(user_id),
            ItemIssuance.returned_at.is_(None),
        )
    )
    inventory_count = (assignment_result.scalar() or 0) + (
        issuance_result.scalar() or 0
    )

    # Count uploaded documents
    doc_result = await db.execute(
        select(func.count())
        .select_from(Document)
        .where(Document.uploaded_by == str(user_id))
    )
    document_count = doc_result.scalar() or 0

    total = training_count + inventory_count + document_count

    return DeletionImpactResponse(
        user_id=str(user_id),
        full_name=user.full_name,
        status=user.status.value if hasattr(user.status, "value") else str(user.status),
        training_records=training_count,
        inventory_items=inventory_count,
        documents=document_count,
        total_records=total,
    )


@router.post("/{user_id}/photo", status_code=status.HTTP_200_OK)
async def upload_photo(
    user_id: UUID,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Upload a profile photo for a member.

    Security measures:
    - MIME type validation (only jpeg, png, webp)
    - File size limit (5MB)
    - Image re-encoding to prevent polyglot attacks
    - EXIF metadata stripping
    - Resize to max 512x512

    Self-upload allowed; admins with `members.manage` can upload for others.

    **Authentication required**
    """
    import base64

    # Permission check
    is_self = str(current_user.id) == str(user_id)
    if not is_self:
        perm_result = await db.execute(
            select(User)
            .where(User.id == current_user.id)
            .options(selectinload(User.positions))
        )
        perm_user = perm_result.scalar_one()
        user_permissions = _collect_user_permissions(perm_user)
        if not _has_permission("members.manage", user_permissions):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You can only upload your own photo",
            )

    # File size check (5MB)
    MAX_SIZE = 5 * 1024 * 1024
    contents = await file.read()
    if len(contents) > MAX_SIZE:
        raise CodedHTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="File size must be under 5MB",
            error_code=ErrorCode.UPLD_TOO_LARGE,
        )

    # MIME type validation using file content (not just extension)
    ALLOWED_MIME_TYPES = {"image/jpeg", "image/png", "image/webp"}
    try:
        import magic

        detected_mime = magic.from_buffer(contents, mime=True)
    except ImportError:
        # Fallback: check file header bytes
        if contents[:8] == b"\x89PNG\r\n\x1a\n":
            detected_mime = "image/png"
        elif contents[:2] == b"\xff\xd8":
            detected_mime = "image/jpeg"
        elif contents[:4] == b"RIFF" and contents[8:12] == b"WEBP":
            detected_mime = "image/webp"
        else:
            detected_mime = "unknown"

    if detected_mime not in ALLOWED_MIME_TYPES:
        raise CodedHTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid file type. Allowed: JPEG, PNG, WebP. Detected: {detected_mime}",
            error_code=ErrorCode.UPLD_TYPE_NOT_ALLOWED,
        )

    # Optimize image: resize, strip EXIF, convert to WebP (smaller files)
    try:
        from app.utils.image_processing import IMAGE_SIZE_LIMITS, optimize_image

        clean_contents = optimize_image(
            contents,
            max_size=IMAGE_SIZE_LIMITS["avatar"],  # 400x400 for profile photos
            quality=85,
            output_format="WEBP",
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=safe_error_detail(e),
        )

    # Store as base64 data URI
    photo_data_uri = (
        f"data:image/webp;base64,{base64.b64encode(clean_contents).decode()}"
    )

    result = await db.execute(
        select(User)
        .where(User.id == str(user_id))
        .where(User.organization_id == str(current_user.organization_id))
        .where(User.deleted_at.is_(None))
    )
    user = result.scalar_one_or_none()

    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="User not found"
        )

    user.photo_url = photo_data_uri
    await db.commit()

    await log_audit_event(
        db=db,
        event_type="user_photo_updated",
        event_category="user_management",
        severity="info",
        event_data={
            "target_user_id": str(user_id),
            "is_self_update": is_self,
        },
        user_id=str(current_user.id),
        username=current_user.username,
    )

    return {"message": "Photo uploaded successfully", "photo_url": photo_data_uri}


@router.delete("/{user_id}/photo", status_code=status.HTTP_200_OK)
async def delete_photo(
    user_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Remove a member's profile photo.

    Self-removal allowed; admins with `members.manage` can remove for others.

    **Authentication required**
    """
    is_self = str(current_user.id) == str(user_id)
    if not is_self:
        perm_result = await db.execute(
            select(User)
            .where(User.id == current_user.id)
            .options(selectinload(User.positions))
        )
        perm_user = perm_result.scalar_one()
        user_permissions = _collect_user_permissions(perm_user)
        if not _has_permission("members.manage", user_permissions):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You can only remove your own photo",
            )

    result = await db.execute(
        select(User)
        .where(User.id == str(user_id))
        .where(User.organization_id == str(current_user.organization_id))
        .where(User.deleted_at.is_(None))
    )
    user = result.scalar_one_or_none()

    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="User not found"
        )

    user.photo_url = None
    await db.commit()

    await log_audit_event(
        db=db,
        event_type="user_photo_removed",
        event_category="user_management",
        severity="info",
        event_data={
            "target_user_id": str(user_id),
            "is_self_update": is_self,
        },
        user_id=str(current_user.id),
        username=current_user.username,
    )

    return {"message": "Photo removed successfully"}


# Human-readable descriptions for audit event types
_AUDIT_EVENT_DESCRIPTIONS = {
    "user_created": "Member account created",
    "user_deleted": "Member account deactivated (soft delete)",
    "user_hard_deleted": "Member account permanently deleted",
    "user_profile_updated": "Member profile updated",
    "user_updated": "Member contact information updated",
    "user_role_assigned": "Member role assignment changed",
    "user_role_removed": "Role removed from member",
    "user_viewed": "Member profile viewed",
    "admin_password_reset": "Password reset by administrator",
    "user_photo_updated": "Profile photo updated",
    "user_photo_removed": "Profile photo removed",
    "member_status_changed": "Member status changed",
    "membership_type_changed": "Membership type changed",
    "member_archived": "Member archived",
    "member_reactivated": "Member reactivated",
    "leave_of_absence_created": "Leave of absence created",
    "leave_of_absence_updated": "Leave of absence updated",
    "leave_of_absence_deleted": "Leave of absence deactivated",
    "admin_mfa_reset": "Two-factor authentication reset by administrator",
    "compliance_exemption_changed": "Compliance exemption changed",
}

# The audit page's Event Type dropdown speaks a coarser vocabulary than the
# stored event types — one entry covers several. Selecting "Profile Updates"
# sent "profile_update", which was compared for equality against the stored
# "user_profile_updated" and matched nothing, so every option except "All
# Events" emptied the page and told the reader to clear the filter.
_AUDIT_EVENT_FILTERS: dict[str, list[str]] = {
    "profile_update": [
        "user_profile_updated",
        "user_updated",
        "user_photo_updated",
        "user_photo_removed",
    ],
    "status_change": [
        "member_status_changed",
        "member_archived",
        "member_reactivated",
        "leave_of_absence_created",
        "leave_of_absence_updated",
        "leave_of_absence_deleted",
    ],
    "role_change": ["user_role_assigned", "user_role_removed"],
    "password_reset": ["admin_password_reset"],
    "membership_change": ["membership_type_changed"],
}


@router.get("/{user_id}/audit-history", response_model=list[MemberAuditLogEntry])
async def get_member_audit_history(
    user_id: UUID,
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=100),
    event_type: str | None = Query(None, description="Filter by event type"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("members.manage")),
):
    """
    Get audit history for a specific member.

    Returns a chronological log of changes to the member's record including
    who made each change, what was changed, and when.

    **Authentication required**

    **Permissions required:** members.manage
    """
    # Verify the target user exists in the same org
    result = await db.execute(
        select(User)
        .where(User.id == str(user_id))
        .where(User.organization_id == str(current_user.organization_id))
    )
    if not result.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="User not found"
        )

    # Relevant event types for member history
    member_event_types = list(_AUDIT_EVENT_DESCRIPTIONS.keys())

    # Query audit logs where this user is the target (in event_data)
    # We search for the user_id appearing in the JSON event_data
    user_id_str = str(user_id)
    query = (
        select(AuditLog)
        # Org filter (closes the deferred orgs-roles-users audit item):
        # without it, matching event_data ids could surface another org's
        # rows. Legacy rows were backfilled from user_id.
        .where(AuditLog.organization_id == str(current_user.organization_id))
        .where(AuditLog.event_type.in_(member_event_types))
        .where(AuditLog.event_category == "user_management")
        .where(
            or_(
                # User was the target of the action
                AuditLog.event_data["target_user_id"].as_string() == user_id_str,
                AuditLog.event_data["new_user_id"].as_string() == user_id_str,
                AuditLog.event_data["updated_user_id"].as_string() == user_id_str,
                AuditLog.event_data["deleted_user_id"].as_string() == user_id_str,
                AuditLog.event_data["viewed_user_id"].as_string() == user_id_str,
                # User performed a self-inherent action (no separate target
                # recorded at all — e.g. updating their own profile). This
                # must NOT fire whenever the user merely acted as the actor:
                # an event with one of the target keys above pointing at
                # someone else is already correctly included or excluded by
                # those clauses on its own merits, and including it here too
                # would leak that other member's event_data into this
                # member's history under their name.
                and_(
                    AuditLog.user_id == user_id_str,
                    AuditLog.event_data["target_user_id"].as_string().is_(None),
                    AuditLog.event_data["new_user_id"].as_string().is_(None),
                    AuditLog.event_data["updated_user_id"].as_string().is_(None),
                    AuditLog.event_data["deleted_user_id"].as_string().is_(None),
                    AuditLog.event_data["viewed_user_id"].as_string().is_(None),
                ),
            )
        )
        .order_by(AuditLog.timestamp.desc())
    )

    if event_type:
        # An unrecognised value falls through to an exact match, so a caller
        # naming a stored type directly still works.
        query = query.where(
            AuditLog.event_type.in_(_AUDIT_EVENT_FILTERS.get(event_type, [event_type]))
        )

    # Paginate
    offset = (page - 1) * page_size
    query = query.offset(offset).limit(page_size)

    result = await db.execute(query)
    logs = result.scalars().all()

    # Convert to response format
    entries = []
    for log in logs:
        description = _AUDIT_EVENT_DESCRIPTIONS.get(log.event_type, log.event_type)

        # Enhance description with details from event_data
        data = log.event_data or {}
        if log.event_type == "user_profile_updated":
            fields = data.get("fields_updated", [])
            if fields:
                description += f": {', '.join(fields)}"
        elif log.event_type == "user_role_assigned":
            action = data.get("action", "")
            role_name = data.get("role_name", "")
            if action == "role_added" and role_name:
                description = f"Role added: {role_name}"
            elif action == "role_removed" and role_name:
                description = f"Role removed: {role_name}"
            elif action == "roles_replaced":
                description = "All roles replaced"
        elif log.event_type == "member_status_changed":
            prev = data.get("previous_status", "")
            new = data.get("new_status", "")
            if prev and new:
                description = f"Status changed: {prev} → {new}"

        entries.append(
            MemberAuditLogEntry(
                id=log.id,
                timestamp=log.timestamp,
                event_type=log.event_type,
                severity=(
                    log.severity.value
                    if hasattr(log.severity, "value")
                    else str(log.severity)
                ),
                description=description,
                changed_by_username=log.username,
                changed_by_user_id=log.user_id,
                event_data=data,
            )
        )

    return entries


@router.get("/me/data-export")
async def export_my_data(
    request: Request,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Download everything the system stores about the calling member
    (data portability / subject access). Self-scoped by construction —
    there is no way to export another member's data through this route.

    Rate limited hard: assembling the export touches every module's tables.
    """
    await check_rate_limit(
        request, max_requests=3, window_seconds=3600, scope="data_export"
    )

    from app.services.data_export_service import DataExportService

    export = await DataExportService(db).export_user_data(current_user)

    await log_audit_event(
        db=db,
        event_type="user_data_export",
        event_category="security",
        severity="info",
        user_id=str(current_user.id),
        organization_id=str(current_user.organization_id),
        ip_address=get_client_ip(request),
        event_data={"sections": len(export)},
    )
    await db.commit()

    filename = "logbook-personal-data-export.json"
    return JSONResponse(
        content=export,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post("/{user_id}/anonymize", status_code=status.HTTP_200_OK)
async def anonymize_member(
    user_id: str,
    request: Request,
    current_user: User = Depends(require_permission("members.manage")),
    db: AsyncSession = Depends(get_db),
):
    """
    Irreversibly scrub a departed member's PII while retaining their
    operational history (training, attendance, property custody) linked to
    an anonymized shell record. Refused for active members and for self.

    See member_anonymization_service for exactly what is scrubbed, kept,
    and why audit logs / election records are never rewritten.
    """
    if str(current_user.id) == str(user_id):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You cannot anonymize your own account",
        )

    from app.services.member_anonymization_service import MemberAnonymizationService

    service = MemberAnonymizationService(db)
    user = await service.get_user_for_anonymization(
        user_id, str(current_user.organization_id)
    )
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="User not found"
        )

    try:
        summary = await service.anonymize_member(user)
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=safe_error_detail(e)
        )

    # Deliberately no name/email in the event payload: audit rows are
    # immutable, so identity written here would survive the anonymization.
    await log_audit_event(
        db=db,
        event_type="user_anonymized",
        event_category="security",
        severity="warning",
        user_id=str(current_user.id),
        organization_id=str(current_user.organization_id),
        ip_address=get_client_ip(request),
        event_data={"anonymized_user_id": str(user_id)},
    )
    await db.commit()
    return summary


@router.get("/me/consents")
async def get_my_consents(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    The calling member's optional-processing consents (photo use, public
    roster listing, SMS notifications). granted=null means never asked —
    consumers treat that exactly like a refusal.
    """
    from app.services.consent_service import ConsentService

    return await ConsentService(db).list_for_user(current_user)


@router.get("/consents/photo-use")
async def get_photo_use_roster(
    include_inactive: bool = Query(
        False, description="Include members who are not currently active"
    ),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(
        # NOT users.view. That reads as a narrow grant and is not one: 25 of
        # the 30 default positions carry it, the EMS Supply Officer and
        # Apparatus Officer among them. Gating a whole-department list of who
        # agreed to be photographed on it would have made this endpoint a
        # *weaker* gate than the per-member ``/{user_id}/consents`` beside it
        # (users.edit or members.manage) while returning strictly more.
        #
        # users.view_consents exists because the Historian and Public Outreach
        # positions have a real claim on this page — a historian curates the
        # photo archive — and share nothing with each other but broad grants
        # (users.view, members.view, events.view). Widening to any of those
        # would have reopened exactly what the paragraph above closed, so the
        # grant they needed had to be one that means only this.
        require_permission(
            "users.view_consents",
            "notifications.manage",
            "members.manage",
            "users.edit",
        )
    ),
):
    """
    Every member's photo-use standing, for the PIO / communications officer
    choosing images for a newsletter, social post, or press release.

    The consent is collected in User Settings and was, until this endpoint,
    only readable one member at a time — which is not a workable check for
    somebody selecting from a folder of incident photos. Read-only: a
    member's consent is theirs to set, so there is no admin write counterpart
    here, for the same reason ``/{user_id}/consents`` has none.

    Deliberately carries **no contact fields**. The member directory gates
    email behind the organization's contact-visibility setting; rather than
    reimplement that here (and drift from it), this returns only what
    identifies a member on a photo call sheet — name, rank, station, and
    membership number.

    **Permissions required:** users.view_consents, notifications.manage,
    members.manage, or users.edit
    """
    from app.models.consent import ConsentType
    from app.services.consent_service import ConsentService

    return await ConsentService(db).roster(
        organization_id=str(current_user.organization_id),
        consent_type=ConsentType.PHOTO_USE,
        include_inactive=include_inactive,
    )


@router.get("/{user_id}/consents")
async def get_user_consents(
    user_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Read another member's consents, for staff editing that member's contact
    and notification settings.

    **Read-only by design, and there is deliberately no admin write
    counterpart.** SMS consent is a TCPA record of what the *member* agreed
    to; an officer ticking a box on their behalf would not be consent. Staff
    need to see it because the notification preferences they can edit are
    meaningless without it — the SMS preference cannot switch texts on for a
    member who never consented, only off for one who did.
    """
    if str(current_user.id) != str(user_id):
        user_perms = _collect_user_permissions(current_user)
        if not _has_permission("users.edit", user_perms) and not _has_permission(
            "members.manage", user_perms
        ):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You do not have permission to view this member's consents",
            )

    # Org-scoped: a permission is held within the caller's own organization and
    # says nothing about a member of another one (CLAUDE.md pitfall 14b).
    result = await db.execute(
        select(User)
        .where(User.id == str(user_id))
        .where(User.organization_id == str(current_user.organization_id))
        .where(User.deleted_at.is_(None))
    )
    member = result.scalar_one_or_none()
    if not member:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="User not found"
        )

    from app.services.consent_service import ConsentService

    return await ConsentService(db).list_for_user(member)


@router.put("/me/consents/{consent_type}")
async def set_my_consent(
    consent_type: str,
    request: Request,
    granted: bool = Query(...),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Record the calling member's consent choice. Self-scoped by construction;
    every change is written to the tamper-evident audit log, which serves
    as the immutable consent ledger.
    """
    from app.models.consent import ConsentType
    from app.services.consent_service import ConsentService

    try:
        parsed_type = ConsentType(consent_type)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unknown consent type: {consent_type}",
        )

    row = await ConsentService(db).set_consent(current_user, parsed_type, granted)

    await log_audit_event(
        db=db,
        event_type="consent_updated",
        event_category="security",
        severity="info",
        user_id=str(current_user.id),
        organization_id=str(current_user.organization_id),
        ip_address=get_client_ip(request),
        event_data={"consent_type": parsed_type.value, "granted": granted},
    )
    await db.commit()

    return {
        "consent_type": (
            row.consent_type.value
            if hasattr(row.consent_type, "value")
            else row.consent_type
        ),
        "granted": row.granted,
    }
