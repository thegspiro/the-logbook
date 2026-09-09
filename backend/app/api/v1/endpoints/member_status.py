"""
Member Status Change API Endpoints

Provides a dedicated endpoint for changing member status.
When a member is dropped (voluntarily or involuntarily), a property-return
report is automatically generated, saved to documents, and optionally emailed.
"""

import copy
from collections import Counter
from datetime import datetime, timezone
from typing import Any
from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from pydantic import BaseModel, Field, ValidationError
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.dependencies import require_permission
from app.core.audit import log_audit_event
from app.core.constants import ADMIN_NOTIFY_ROLE_SLUGS
from app.core.database import database_manager, get_db
from app.core.utils import ensure_found, handle_service_errors
from app.models.user import Organization, User, UserStatus
from app.schemas.organization import MembershipTierSettings
from app.services.admin_continuity_service import (
    LastAdministratorError,
    assert_not_last_administrator,
)
from app.utils.membership import is_administrative

router = APIRouter()

# Lifecycle state machine for admin-driven status changes (module audit,
# roles #5 — previously any-to-any). Transitions reflect the membership
# lifecycle: probationary/active/inactive/leave/suspended interchange within
# membership; retirement and drops end it; a dropped or retired member can be
# reinstated (probationary or active, per bylaws). ARCHIVED is deliberately
# absent on both sides: /archive and /reactivate are dedicated endpoints with
# their own side effects, and this endpoint must not bypass them.
ALLOWED_STATUS_TRANSITIONS: dict[UserStatus, frozenset[UserStatus]] = {
    UserStatus.PROBATIONARY: frozenset(
        {
            UserStatus.ACTIVE,
            UserStatus.INACTIVE,
            UserStatus.SUSPENDED,
            UserStatus.LEAVE,
            UserStatus.DROPPED_VOLUNTARY,
            UserStatus.DROPPED_INVOLUNTARY,
        }
    ),
    UserStatus.ACTIVE: frozenset(
        {
            UserStatus.PROBATIONARY,
            UserStatus.INACTIVE,
            UserStatus.SUSPENDED,
            UserStatus.LEAVE,
            UserStatus.RETIRED,
            UserStatus.DROPPED_VOLUNTARY,
            UserStatus.DROPPED_INVOLUNTARY,
        }
    ),
    UserStatus.INACTIVE: frozenset(
        {
            UserStatus.PROBATIONARY,
            UserStatus.ACTIVE,
            UserStatus.SUSPENDED,
            UserStatus.LEAVE,
            UserStatus.RETIRED,
            UserStatus.DROPPED_VOLUNTARY,
            UserStatus.DROPPED_INVOLUNTARY,
        }
    ),
    # Suspension resolves to reinstatement or termination — never straight
    # to leave/retirement, which would launder an unresolved suspension.
    UserStatus.SUSPENDED: frozenset(
        {
            UserStatus.PROBATIONARY,
            UserStatus.ACTIVE,
            UserStatus.INACTIVE,
            UserStatus.DROPPED_VOLUNTARY,
            UserStatus.DROPPED_INVOLUNTARY,
        }
    ),
    UserStatus.LEAVE: frozenset(
        {
            UserStatus.ACTIVE,
            UserStatus.INACTIVE,
            UserStatus.SUSPENDED,
            UserStatus.RETIRED,
            UserStatus.DROPPED_VOLUNTARY,
            UserStatus.DROPPED_INVOLUNTARY,
        }
    ),
    UserStatus.RETIRED: frozenset(
        {
            UserStatus.ACTIVE,
            UserStatus.INACTIVE,
        }
    ),
    UserStatus.DROPPED_VOLUNTARY: frozenset(
        {
            UserStatus.PROBATIONARY,
            UserStatus.ACTIVE,
        }
    ),
    UserStatus.DROPPED_INVOLUNTARY: frozenset(
        {
            UserStatus.PROBATIONARY,
            UserStatus.ACTIVE,
        }
    ),
    UserStatus.ARCHIVED: frozenset(),
}


def assert_transition_allowed(
    current_status: UserStatus, new_status: UserStatus
) -> None:
    """Raise HTTPException(400) when the lifecycle change is not allowed."""
    if new_status == UserStatus.ARCHIVED:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Use the archive endpoint to archive a member",
        )
    allowed = ALLOWED_STATUS_TRANSITIONS.get(current_status, frozenset())
    if new_status not in allowed:
        if current_status == UserStatus.ARCHIVED:
            detail = "Member is archived; use the reactivate endpoint"
        else:
            valid = ", ".join(sorted(s.value for s in allowed))
            detail = (
                f"Cannot change status from '{current_status.value}' to "
                f"'{new_status.value}'. Allowed: {valid}"
            )
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=detail,
        )


class MemberStatusChangeRequest(BaseModel):
    """Request body for changing a member's status."""

    new_status: str = Field(
        ..., description="New status value (e.g. 'dropped_voluntary')"
    )
    reason: str | None = Field(None, description="Reason for the status change")
    send_property_return_email: bool = Field(
        True, description="Email the property return report to the member"
    )
    return_deadline_days: int = Field(
        14, ge=1, le=90, description="Days to return property (1-90)"
    )
    custom_instructions: str | None = Field(
        None, description="Extra paragraph added to the letter"
    )


class MemberStatusChangeResponse(BaseModel):
    """Response after a status change."""

    user_id: str
    previous_status: str
    new_status: str
    property_return_report: dict[str, Any] | None = None
    document_id: str | None = None
    email_sent: bool | None = None


async def _send_property_return_email(
    *,
    organization_id: str,
    to_emails: list[str],
    cc_emails: list[str],
    report_data: dict[str, Any],
    member_email: str,
) -> None:
    """Email the member's property-return report as a background task.

    Runs after the response, so it opens its own DB session and reloads the
    organization rather than reusing the request session or a detached ORM
    object. ``EmailService`` is constructed while the session is open so it
    caches the org SMTP config before the session closes. Never raises.
    """
    from loguru import logger

    try:
        from app.services.email_service import EmailService
        from app.services.email_template_service import (
            build_items_list_html,
            build_items_list_text,
        )

        async for session in database_manager.get_session():
            org = (
                await session.execute(
                    select(Organization).where(Organization.id == organization_id)
                )
            ).scalar_one_or_none()
            email_svc = EmailService(org)
            org_name = org.name if org else "Department"

            items = report_data.get("items", [])
            total_val = report_data.get("total_value", 0.0)
            items_html = build_items_list_html(items, total_val, include_condition=True)
            items_text = build_items_list_text(items, total_val, include_condition=True)

            context = {
                "member_name": report_data["member_name"],
                "organization_name": org_name,
                "drop_type_display": report_data["drop_type_display"],
                "reason": report_data.get("reason", ""),
                "effective_date": report_data["effective_date"],
                "return_deadline": report_data["return_deadline"],
                "item_count": str(report_data["item_count"]),
                "total_value": f"{total_val:,.2f}",
                "items_list_html": items_html,
                "items_list_text": items_text,
                "performed_by_name": report_data["performed_by_name"],
                "performed_by_title": report_data["performed_by_title"],
            }

            subject = None
            html_body = None
            text_body = None

            # Try loading the admin-configured template (same session).
            try:
                from app.models.email_template import EmailTemplateType
                from app.services.email_template_service import EmailTemplateService

                tmpl_svc = EmailTemplateService(session)
                template = await tmpl_svc.get_template(
                    organization_id,
                    EmailTemplateType.MEMBER_DROPPED,
                )
                if template:
                    subject, html_body, text_body = tmpl_svc.render(
                        template, context, organization=org
                    )
            except Exception as tmpl_err:
                logger.warning(
                    f"Failed to load member_dropped template, using default: {tmpl_err}"
                )

            # Fall back to inline default.
            if not subject:
                import html as html_lib
                import re

                from app.services.email_template_service import (
                    DEFAULT_CSS,
                    DEFAULT_MEMBER_DROPPED_HTML,
                    DEFAULT_MEMBER_DROPPED_TEXT,
                )

                # `member_name`/`reason`/`performed_by_name` are free text an
                # officer or a member's own profile controls — `render()`'s
                # template path (above) HTML-escapes them via
                # `_replace_variables`; this fallback must too, or a `reason`
                # containing markup reaches this email, and every CC'd admin's
                # inbox, unescaped. `items_list_html` is the one exception: it
                # is pre-built, already-escaped markup (`build_items_list_html`),
                # matching `_RAW_HTML_VARIABLES` in email_template_service.py.
                # The plain-text body is never escaped — it is not parsed as
                # markup, and escaping it would corrupt names like "O'Brien".
                # `str(val)` is passed as a replacement *function*, not a raw
                # string, so a value containing a literal backslash sequence
                # (e.g. "\1") can't be misread by `re.sub` as a backreference.
                subject = f"Notice of Department Property Return — {org_name}"
                rendered_html = DEFAULT_MEMBER_DROPPED_HTML
                rendered_text = DEFAULT_MEMBER_DROPPED_TEXT
                for key, val in context.items():
                    pattern = r"\{\{\s*" + re.escape(key) + r"\s*\}\}"
                    text_val = str(val)
                    html_val = (
                        text_val
                        if key == "items_list_html"
                        else html_lib.escape(text_val)
                    )
                    rendered_html = re.sub(
                        pattern, lambda _m, v=html_val: v, rendered_html
                    )
                    rendered_text = re.sub(
                        pattern, lambda _m, v=text_val: v, rendered_text
                    )
                html_body = f"<!DOCTYPE html><html><head><style>{DEFAULT_CSS}</style></head><body>{rendered_html}</body></html>"
                text_body = rendered_text

        # Outbound delivery may block for the SMTP timeout. Do it only after
        # the generator has committed and closed the database session so slow
        # mail infrastructure cannot exhaust the connection pool.
        await email_svc.send_email(
            to_emails=to_emails,
            subject=subject,
            html_body=html_body,
            text_body=text_body,
            cc_emails=cc_emails if cc_emails else None,
        )
    except Exception as e:
        logger.error(f"Failed to send property return email to {member_email}: {e}")


@router.patch("/{user_id}/status", response_model=MemberStatusChangeResponse)
async def change_member_status(
    user_id: UUID,
    request: MemberStatusChangeRequest,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("members.manage")),
):
    """
    Change a member's status.

    When the new status is `dropped_voluntary` or `dropped_involuntary`:
      1. A formal property-return report is generated listing all assigned items
      2. The report is saved to the Documents module (Reports folder)
      3. If send_property_return_email is True, the report is emailed to the member
      4. An audit event is logged

    Requires `members.manage` permission.
    """
    # Validate new_status is a valid UserStatus
    try:
        new_status = UserStatus(request.new_status)
    except ValueError:
        valid = [s.value for s in UserStatus]
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid status '{request.new_status}'. Valid values: {valid}",
        )

    # Load the target member
    result = await db.execute(
        select(User)
        .where(User.id == str(user_id))
        .where(User.organization_id == current_user.organization_id)
        .where(User.deleted_at.is_(None))
        .options(selectinload(User.roles))
    )
    member = ensure_found(result.scalar_one_or_none(), "Member")

    previous_status = (
        member.status.value if hasattr(member.status, "value") else str(member.status)
    )

    # Prevent no-op
    if member.status == new_status:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Member is already {new_status.value}",
        )

    # Enforce the lifecycle state machine
    assert_transition_allowed(UserStatus(previous_status), new_status)

    # Every status other than ACTIVE fails the is_active check that
    # authentication requires, so this endpoint is the cheapest single-request
    # path to locking an organization out of its own admin tools. Checked after
    # the transition rules: if the change is not a legal one at all, saying so
    # is more useful than explaining who would be left holding the keys.
    if new_status != UserStatus.ACTIVE:
        try:
            await assert_not_last_administrator(
                db,
                str(current_user.organization_id),
                member.id,
                action=f"set to {new_status.value}",
            )
        except LastAdministratorError as e:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

    # Update the status and record when it changed
    member.status = new_status
    member.status_changed_at = datetime.now(timezone.utc)
    member.status_change_reason = request.reason
    await db.commit()
    await db.refresh(member)

    # Audit log
    await log_audit_event(
        db=db,
        event_type="member_status_changed",
        event_category="user_management",
        severity="warning" if "dropped" in new_status.value else "info",
        event_data={
            "target_user_id": str(user_id),
            "member_name": member.full_name,
            "previous_status": previous_status,
            "new_status": new_status.value,
            "reason": request.reason,
        },
        user_id=str(current_user.id),
        username=current_user.username,
    )

    response = MemberStatusChangeResponse(
        user_id=str(user_id),
        previous_status=previous_status,
        new_status=new_status.value,
    )

    # --- Auto-generate property return report for drops ---
    if new_status in (UserStatus.DROPPED_VOLUNTARY, UserStatus.DROPPED_INVOLUNTARY):
        from app.services.property_return_service import PropertyReturnService

        prs = PropertyReturnService(db)
        report_data, html_content = await prs.generate_report(
            user_id=str(user_id),
            organization_id=str(current_user.organization_id),
            drop_type=new_status.value,
            performed_by=str(current_user.id),
            return_deadline_days=request.return_deadline_days,
            custom_instructions=request.custom_instructions,
            reason=request.reason,
        )

        response.property_return_report = {
            "member_name": report_data["member_name"],
            "drop_type": report_data["drop_type_display"],
            "item_count": report_data["item_count"],
            "total_value": report_data["total_value"],
            "return_deadline": report_data["return_deadline"],
        }

        # Save to documents
        doc = await prs.save_as_document(
            organization_id=str(current_user.organization_id),
            member_name=member.full_name,
            html_content=html_content,
            created_by=str(current_user.id),
        )
        if doc:
            response.document_id = str(doc.id)

        # Auto-create departure clearance so items can be tracked and resolved
        try:
            from app.services.departure_clearance_service import (
                DepartureClearanceService,
            )

            clearance_svc = DepartureClearanceService(db)
            _clearance, _cl_err = await clearance_svc.initiate_clearance(
                user_id=str(user_id),
                organization_id=str(current_user.organization_id),
                initiated_by=str(current_user.id),
                departure_type=new_status.value,
                return_deadline_days=request.return_deadline_days,
                notes=f"Auto-created from status change to {new_status.value}",
            )
            if _cl_err:
                from loguru import logger as _lg

                _lg.warning(f"Could not auto-create departure clearance: {_cl_err}")
        except Exception as _e:
            from loguru import logger as _lg

            _lg.error(f"Failed to auto-create departure clearance: {_e}")

        # Email the report to the member (with configurable CC and personal email)
        if request.send_property_return_email and member.email:
            org_result = await db.execute(
                select(Organization).where(
                    Organization.id == current_user.organization_id
                )
            )
            organization = org_result.scalar_one_or_none()

            # Load drop notification settings from organization
            org_settings = (organization.settings or {}) if organization else {}
            drop_notif_config = org_settings.get("member_drop_notifications", {})
            cc_role_names = drop_notif_config.get("cc_roles", ADMIN_NOTIFY_ROLE_SLUGS)
            cc_static_emails = drop_notif_config.get("cc_emails", [])
            include_personal = drop_notif_config.get("include_personal_email", True)

            # Build CC list from roles
            cc_emails = list(cc_static_emails)  # start with static list
            if cc_role_names:
                cc_users_result = await db.execute(
                    select(User)
                    .where(
                        User.organization_id == current_user.organization_id,
                        User.status == UserStatus.ACTIVE,
                        User.deleted_at.is_(None),
                    )
                    .options(selectinload(User.roles))
                )
                cc_users = cc_users_result.scalars().all()
                for u in cc_users:
                    role_slugs = [r.slug for r in (u.roles or [])]
                    if any(r in role_slugs for r in cc_role_names):
                        if (
                            u.email
                            and u.email not in cc_emails
                            and u.id != str(user_id)
                        ):
                            cc_emails.append(u.email)

            # Build recipient list — primary email + optionally personal email
            to_emails = [member.email]
            if include_personal and getattr(member, "personal_email", None):
                if member.personal_email not in to_emails:
                    to_emails.append(member.personal_email)

            background_tasks.add_task(
                _send_property_return_email,
                organization_id=str(current_user.organization_id),
                to_emails=to_emails,
                cc_emails=cc_emails,
                report_data=report_data,
                member_email=member.email,
            )
            response.email_sent = True

    return response


@router.get("/{user_id}/property-return-report")
async def get_property_return_preview(
    user_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("members.manage")),
):
    """
    Preview the property-return report for a member without changing their status.
    Useful for reviewing what items are assigned before performing a drop.

    Requires `members.manage` permission.
    """
    from app.services.property_return_service import PropertyReturnService

    # Verify member exists in same org
    result = await db.execute(
        select(User)
        .where(User.id == str(user_id))
        .where(User.organization_id == current_user.organization_id)
        .where(User.deleted_at.is_(None))
    )
    ensure_found(result.scalar_one_or_none(), "Member")

    prs = PropertyReturnService(db)
    report_data, html_content = await prs.generate_report(
        user_id=str(user_id),
        organization_id=str(current_user.organization_id),
        drop_type="dropped_voluntary",
        performed_by=str(current_user.id),
    )

    return {
        "member_name": report_data["member_name"],
        "item_count": report_data["item_count"],
        "total_value": report_data["total_value"],
        "items": report_data["items"],
        "html": html_content,
    }


# ==================== Property Return Reminders ====================


@router.post("/property-return-reminders/process")
async def process_property_return_reminders(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("members.manage")),
):
    """
    Process property-return reminders for the organization.

    Scans all dropped members and sends 30-day and 90-day reminder emails
    to members who still have outstanding inventory items. Each reminder
    type is sent only once per member. Admin/quartermaster users also
    receive a notification for each reminder sent.

    This endpoint is designed to be called daily (via cron, scheduler,
    or manual trigger). Duplicate reminders are prevented automatically.

    Requires `members.manage` permission.
    """
    from app.services.property_return_reminder_service import (
        PropertyReturnReminderService,
    )

    service = PropertyReturnReminderService(db)
    result = await service.process_reminders(
        organization_id=str(current_user.organization_id),
    )
    return result


@router.get("/property-return-reminders/overdue")
async def get_overdue_property_returns(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("members.manage")),
):
    """
    Get a list of all dropped members who still have outstanding
    inventory items, sorted by oldest drop date first.

    Each entry includes: member name, drop date, days since drop,
    items outstanding with values, and which reminders have been sent.

    Requires `members.manage` permission.
    """
    from app.services.property_return_reminder_service import (
        PropertyReturnReminderService,
    )

    service = PropertyReturnReminderService(db)
    overdue_list = await service.get_overdue_returns(
        organization_id=str(current_user.organization_id),
    )
    return {
        "organization_id": str(current_user.organization_id),
        "overdue_count": len(overdue_list),
        "members": overdue_list,
    }


# ==================== Member Archive & Reactivation ====================


class ArchiveMemberRequest(BaseModel):
    """Request body for manually archiving a dropped member."""

    reason: str | None = Field(None, description="Reason for archiving")


class ReactivateMemberRequest(BaseModel):
    """Request body for reactivating an archived member."""

    reason: str | None = Field(None, description="Reason for reactivation")


@router.post("/{user_id}/archive")
async def archive_member(
    user_id: UUID,
    request: ArchiveMemberRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("members.manage")),
):
    """
    Manually archive a dropped member.

    Members are automatically archived when they return all outstanding
    items. This endpoint allows leadership to manually archive a dropped
    member (e.g. items were written off, or the member had no items).

    Only members with a dropped status (`dropped_voluntary` or
    `dropped_involuntary`) can be archived. Use the reactivation
    endpoint to restore an archived member.

    Requires `members.manage` permission.
    """
    # Load the target member
    result = await db.execute(
        select(User)
        .where(User.id == str(user_id))
        .where(User.organization_id == current_user.organization_id)
        .where(User.deleted_at.is_(None))
    )
    member = ensure_found(result.scalar_one_or_none(), "Member")

    if member.status not in (
        UserStatus.DROPPED_VOLUNTARY,
        UserStatus.DROPPED_INVOLUNTARY,
    ):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Only dropped members can be archived. Current status: {member.status.value}",
        )

    try:
        await assert_not_last_administrator(
            db,
            str(current_user.organization_id),
            member.id,
            action="archive",
        )
    except LastAdministratorError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

    previous_status = member.status.value
    now = datetime.now(timezone.utc)
    member.status = UserStatus.ARCHIVED
    member.archived_at = now
    member.status_changed_at = now
    member.status_change_reason = request.reason or "Manually archived by leadership"
    await db.commit()

    # Audit log
    await log_audit_event(
        db=db,
        event_type="member_archived",
        event_category="user_management",
        severity="info",
        event_data={
            "target_user_id": str(user_id),
            "member_name": member.full_name,
            "previous_status": previous_status,
            "new_status": UserStatus.ARCHIVED.value,
            "reason": request.reason or "Manually archived by leadership",
            "archived_by": str(current_user.id),
        },
        user_id=str(current_user.id),
        username=current_user.username,
    )

    return {
        "user_id": str(user_id),
        "member_name": member.full_name,
        "previous_status": previous_status,
        "new_status": UserStatus.ARCHIVED.value,
        "archived_at": now.isoformat(),
    }


@router.post("/{user_id}/reactivate")
async def reactivate_member(
    user_id: UUID,
    request: ReactivateMemberRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("members.manage")),
):
    """
    Reactivate an archived member, restoring them to ACTIVE status.

    Use this when a former member returns to the department and needs
    their account restored. The member's full profile history is
    preserved during archiving, so all prior data is still accessible.

    Requires `members.manage` permission.
    """
    from app.services.member_archive_service import reactivate_member as do_reactivate

    async with handle_service_errors("Failed to reactivate member"):
        result = await do_reactivate(
            db=db,
            user_id=str(user_id),
            organization_id=str(current_user.organization_id),
            reactivated_by=str(current_user.id),
            reason=request.reason,
        )

    return result


@router.get("/archived")
async def get_archived_members(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("members.manage")),
):
    """
    List all archived members in the organization.

    Returns archived members sorted by archive date (most recent first).
    Useful for leadership to review former members for legal requests
    or to identify members eligible for reactivation.

    Requires `members.manage` permission.
    """
    result = await db.execute(
        select(User)
        .where(
            User.organization_id == current_user.organization_id,
            User.status == UserStatus.ARCHIVED,
            User.deleted_at.is_(None),
        )
        .order_by(User.archived_at.desc())
    )
    members = result.scalars().all()

    return {
        "organization_id": str(current_user.organization_id),
        "archived_count": len(members),
        "members": [
            {
                "user_id": str(m.id),
                "name": m.full_name,
                "email": m.email,
                "membership_number": m.membership_number,
                "rank": m.rank,
                "archived_at": m.archived_at.isoformat() if m.archived_at else None,
                "status_change_reason": m.status_change_reason,
            }
            for m in members
        ],
    }


# ==================== Membership Tier Management ====================


class MembershipTypeChangeRequest(BaseModel):
    """Request body for changing a member's membership tier."""

    membership_type: str = Field(
        ...,
        min_length=1,
        max_length=50,
        description="New tier ID (e.g. 'senior', 'life')",
    )
    reason: str | None = Field(None, description="Reason for the tier change")


@router.patch("/{user_id}/membership-type")
async def change_membership_type(
    user_id: UUID,
    request: MembershipTypeChangeRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("members.manage")),
):
    """
    Change a member's membership tier.

    Leadership can promote or adjust a member's tier (e.g. probationary -> active,
    active -> life). The available tiers are configured in Organization Settings >
    membership_tiers.

    Requires `members.manage` permission.
    """
    # Locked, and locked here rather than only in the profile endpoint: this is
    # the other half of the same read-then-write. A request setting a rank and
    # this one setting the class to administrative can otherwise both read an
    # operational, rankless member, both pass, and each write only its own
    # column — leaving the row administrative *and* ranked. Both writers have to
    # take the lock or neither is serialized.
    #
    # populate_existing alongside the lock for the same reason as the profile
    # endpoint: a self-change shares this request's session with whatever
    # already loaded the caller's User row, and expire_on_commit=False leaves
    # that instance in the identity map -- without this a re-SELECT under the
    # lock can still return pre-lock column values.
    result = await db.execute(
        select(User)
        .where(User.id == str(user_id))
        .where(User.organization_id == current_user.organization_id)
        .where(User.deleted_at.is_(None))
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    member = ensure_found(result.scalar_one_or_none(), "Member")

    # Validate the tier exists in org settings
    org_result = await db.execute(
        select(Organization).where(Organization.id == current_user.organization_id)
    )
    organization = org_result.scalar_one_or_none()
    tier_config = (organization.settings or {}).get("membership_tiers", {})
    valid_tier_ids = [t["id"] for t in tier_config.get("tiers", [])]
    # Allow the change even if no tiers are configured (freeform)
    if valid_tier_ids and request.membership_type not in valid_tier_ids:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid membership tier '{request.membership_type}'. Valid tiers: {valid_tier_ids}",
        )

    previous_type = member.membership_type or "active"
    if previous_type == request.membership_type:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Member is already at tier '{request.membership_type}'",
        )

    now = datetime.now(timezone.utc)
    member.membership_type = request.membership_type
    member.membership_type_changed_at = now

    # An administrative member holds no operational rank. A rank is not
    # decoration — its default permissions are unioned into the member's
    # effective set — so leaving one behind would keep chain-of-command
    # authority live on somebody this call just moved out of the chain.
    #
    # The class has to be derived from the new value rather than read off
    # `member.member_class`: `_reconcile_membership` runs at flush, so the
    # column still holds the pre-change class at this point.
    previous_rank = member.rank
    cleared_rank = None
    if previous_rank and is_administrative(None, request.membership_type):
        member.rank = None
        cleared_rank = previous_rank

    await db.commit()

    await log_audit_event(
        db=db,
        event_type="membership_type_changed",
        event_category="user_management",
        severity="info",
        event_data={
            "target_user_id": str(user_id),
            "member_name": member.full_name,
            "previous_type": previous_type,
            "new_type": request.membership_type,
            "reason": request.reason,
            "cleared_rank": cleared_rank,
        },
        user_id=str(current_user.id),
        username=current_user.username,
    )

    return {
        "user_id": str(user_id),
        "member_name": member.full_name,
        "previous_membership_type": previous_type,
        "new_membership_type": request.membership_type,
        "changed_at": now.isoformat(),
    }


@router.post("/advance-membership-tiers")
async def advance_membership_tiers(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("members.manage")),
):
    """
    Auto-advance all eligible members to their next membership tier.

    Scans every active/probationary member, calculates their years of
    service from `hire_date`, and promotes them to the highest tier they
    qualify for based on the organization's `membership_tiers` settings.

    This endpoint is idempotent and designed to be called periodically
    (e.g. daily, monthly, or on-demand by leadership).

    Requires `members.manage` permission.
    """
    from app.services.membership_tier_service import MembershipTierService

    service = MembershipTierService(db)
    result = await service.advance_all(
        organization_id=str(current_user.organization_id),
        performed_by=str(current_user.id),
    )
    return result


@router.get("/membership-tiers/config")
async def get_membership_tier_config(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("members.manage")),
):
    """
    Get the current membership tier configuration.

    Returns all tiers with their benefits (training exemptions, voting rules,
    attendance requirements, etc.).

    **Requires permission: members.manage**
    """
    org_result = await db.execute(
        select(Organization).where(Organization.id == current_user.organization_id)
    )
    organization = ensure_found(org_result.scalar_one_or_none(), "Organization")

    settings = organization.settings or {}
    # An organization onboarded before the ladder was seeded at creation has no
    # `membership_tiers` key at all, and spreading that returned nothing but the
    # counts -- so the editor showed "No tiers configured" under its own copy
    # about the arrangement we ship, and a department could finish setup with no
    # ladder while every reader quietly answered "no" to whatever it was asked.
    #
    # Keyed on the section being absent, not on it being empty: a department
    # that deliberately saved a ladder with no rungs made a decision, and
    # resurrecting the defaults over it would be the same overreach in the other
    # direction.
    tier_config = (
        settings["membership_tiers"]
        if "membership_tiers" in settings
        else MembershipTierSettings().model_dump()
    )
    return {
        **tier_config,
        # How many members currently sit on each tier, so the editor can say so
        # beside the rung and refuse to remove one that is occupied. Reported
        # rather than left to the client to work out: `membership_type` also
        # holds the legacy non-tier values, and counting them as tiers is how
        # you get an editor that offers to delete "administrative".
        "member_counts": await _tier_member_counts(
            db, str(current_user.organization_id)
        ),
    }


async def _tier_member_counts(db: AsyncSession, organization_id: str) -> dict[str, int]:
    """Members per stored ``membership_type``, for the whole roster.

    Deleted members are excluded; every other status is counted. A retired or
    archived member still holds a tier, and removing the rung out from under
    them rewrites a historical record — ``split_membership_type`` returns
    ``(None, None)`` for a value it does not recognise rather than guessing, so
    they would fall out of the operational body and the electorate with nothing
    reporting it.
    """
    result = await db.execute(
        select(User.membership_type, func.count(User.id))
        .where(
            User.organization_id == organization_id,
            User.deleted_at.is_(None),
            User.membership_type.is_not(None),
        )
        .group_by(User.membership_type)
    )
    return {str(tier_id): int(count) for tier_id, count in result.all()}


@router.put("/membership-tiers/config")
async def update_membership_tier_config(
    config: dict,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("members.manage")),
):
    """
    Update membership tier configuration.

    The training officer, compliance officer, or secretary can edit the
    membership requirements for each tier/stage including:
    - `voting_eligible` — whether members at this tier can vote
    - `voting_requires_meeting_attendance` — require attendance % to vote
    - `voting_min_attendance_pct` — minimum attendance percentage (e.g. 50.0)
    - `voting_attendance_period_months` — look-back window for attendance
    - `training_exempt` / `training_exempt_types` — training exemptions
    - `can_hold_office` — office eligibility
    - `years_required` — years of service for auto-advancement

    **Requires permission: members.manage**
    """
    org_result = await db.execute(
        select(Organization).where(Organization.id == current_user.organization_id)
    )
    organization = ensure_found(org_result.scalar_one_or_none(), "Organization")

    # Validated by the model that defines the shape, not by hand. The ad-hoc
    # checks this replaces covered two fields of nine and let everything else
    # through verbatim: a `years_required` of -1, a `voting_attendance_period_months`
    # of 0, an unknown benefit key. Every reader is defensive `.get()` calls, so
    # a malformed rung does not raise — it silently answers "no" to whatever it
    # was asked, and the member is quietly out of the electorate.
    #
    # `member_counts` is reported by the GET and is not part of the stored
    # config; accepting it back would persist a snapshot that is wrong the
    # moment anyone joins.
    submitted = {k: v for k, v in config.items() if k != "member_counts"}
    try:
        validated = MembershipTierSettings.model_validate(submitted)
    except ValidationError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid membership tier configuration: {exc.errors()[0]['msg']}",
        )

    tiers = [tier.model_dump() for tier in validated.tiers]

    # One pass, not a rescan of the whole list per tier: this endpoint is
    # reachable directly and `tiers` is only bounded by the schema's max_length.
    duplicate_ids = sorted(
        tier_id
        for tier_id, count in Counter(t["id"] for t in tiers).items()
        if count > 1
    )
    if duplicate_ids:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Duplicate tier ids: {', '.join(duplicate_ids)}",
        )

    # `sort_order` and `years_required` have to climb together, because two
    # different readers use one each and they must not disagree.
    # `resolve_tier` returns the qualifying rung with the greatest `sort_order`,
    # while qualification itself is by `years_required` -- so a ladder where a
    # lower threshold sits above a higher one makes the monthly `advance_all`
    # *demote*: reorder Life above Senior and a 25-year Life member qualifies
    # for both, resolves to Senior because its sort_order is now greater, and
    # is rewritten overnight. Nothing raises, and the member finds out at the
    # next election.
    #
    # Refused here rather than silently rewriting either field: which one the
    # department meant is not something to guess -- moving the rung and moving
    # the threshold are different intentions.
    by_order = sorted(tiers, key=lambda t: t.get("sort_order", 0))
    for higher, lower in zip(by_order, by_order[1:]):
        if lower.get("years_required", 0) < higher.get("years_required", 0):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=(
                    f"'{lower.get('name') or lower.get('id')}' is above "
                    f"'{higher.get('name') or higher.get('id')}' in the ladder but "
                    f"needs fewer years of service "
                    f"({lower.get('years_required', 0)} vs "
                    f"{higher.get('years_required', 0)}). Members are advanced by "
                    "years of service, so this order would move a long-serving "
                    "member down. Reorder the tiers or change their years."
                ),
            )

    # A tier id is what `User.membership_type` stores, and nothing cascades a
    # rename or backfills a removal. Dropping a rung members are standing on
    # does not move them down it — `split_membership_type` refuses to guess a
    # class for an id it does not recognise, so they leave the operational body
    # and the ballot electorate at once, with nothing saying so. Refused here,
    # naming who, the way delete_rank does.
    existing_ids = {
        tier.get("id")
        for tier in (organization.settings or {})
        .get("membership_tiers", {})
        .get("tiers", [])
        if tier.get("id")
    }
    counts = await _tier_member_counts(db, str(current_user.organization_id))
    submitted_ids = {t["id"] for t in tiers}
    occupied_and_gone = sorted(
        tier_id
        for tier_id in existing_ids - submitted_ids
        if counts.get(tier_id, 0) > 0
    )
    if occupied_and_gone:
        detail = "; ".join(
            f"'{tier_id}' is held by {counts[tier_id]} "
            f"{'member' if counts[tier_id] == 1 else 'members'}"
            for tier_id in occupied_and_gone
        )
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"Cannot remove or rename a tier that members hold: {detail}. "
                "Move those members to another tier first."
            ),
        )

    # Update org settings
    settings = copy.deepcopy(organization.settings or {})
    settings["membership_tiers"] = validated.model_dump()
    organization.settings = settings
    await db.commit()

    await log_audit_event(
        db=db,
        event_type="membership_tier_config_updated",
        event_category="user_management",
        severity="warning",
        event_data={
            "tier_count": len(tiers),
            "tier_ids": [t["id"] for t in tiers],
        },
        user_id=str(current_user.id),
        username=current_user.username,
    )

    return {
        "message": "Membership tier configuration updated",
        "tiers": tiers,
    }


class ComplianceExemptionRequest(BaseModel):
    """Request body for toggling a member's compliance exemption."""

    exempt: bool = Field(
        ..., description="True to exempt the member from compliance tracking"
    )
    reason: str | None = Field(None, description="Reason for the change")


@router.patch("/{user_id}/compliance-exempt")
async def set_compliance_exemption(
    user_id: UUID,
    request: ComplianceExemptionRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("members.manage")),
):
    """
    Mark or unmark a member as exempt from compliance tracking.

    Exempt members are not evaluated against training requirements,
    shift minimums, admin-hour targets, or certificate maintenance.
    They will not appear as non-compliant in reports or dashboards.

    Typical use: retired members, honorary members, or members on
    extended leave.

    Requires ``members.manage`` permission.
    """
    result = await db.execute(
        select(User)
        .where(User.id == str(user_id))
        .where(User.organization_id == current_user.organization_id)
        .where(User.deleted_at.is_(None))
    )
    member = ensure_found(result.scalar_one_or_none(), "Member")

    previous = bool(member.compliance_exempt)
    if previous == request.exempt:
        label = "exempt" if request.exempt else "not exempt"
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Member is already {label}",
        )

    member.compliance_exempt = request.exempt
    await db.commit()

    await log_audit_event(
        db=db,
        event_type="compliance_exemption_changed",
        event_category="user_management",
        severity="warning",
        event_data={
            "target_user_id": str(user_id),
            "member_name": member.full_name,
            "previous_exempt": previous,
            "new_exempt": request.exempt,
            "reason": request.reason,
        },
        user_id=str(current_user.id),
        username=current_user.username,
    )

    return {
        "user_id": str(user_id),
        "member_name": member.full_name,
        "compliance_exempt": request.exempt,
    }
