"""The scheduled leave emails, and the emails a leave request sends.

**Leave ending** (daily): the department's chosen number of days before a
leave's end date, the member is told when their training requirements apply
again -- measured by the department's leave month rule, through the same
``month_waivers`` the requirement screens use (CLAUDE.md pitfall #29) -- and,
if the department copies them, the officers who manage leave are told too.

**Open-ended digest** (monthly): the officers who manage leave get one list of
the leaves with no end date that began six or more months ago. Sent by the
first daily run of each month, so a server down on the 1st sends it on the
2nd rather than skipping the month.

**Each is claimed before it is sent** (pitfall #36), in ``leave_notice_sends``:
a reminder per leave and end date, the digest per month. The claim is
committed first and released only if no email could be sent, so a re-run or
a second worker sends nothing (at most once).

**Requests**: the approvers are emailed when a member asks; the member when a
request is denied. An approval is told by the Leave of Absence Notice, which
already carries the dates and what the leave does to the member's training.

None of these carries a leave's reason or its type.
"""

import html
from datetime import date, timedelta
from typing import List, Optional, Sequence

from dateutil.relativedelta import relativedelta
from loguru import logger
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.dependencies import user_has_permission
from app.core.config import settings as app_settings
from app.models.email_template import EmailTemplateType
from app.models.leave_request import LeaveNoticeSend, LeaveRequest, LeaveRequestStatus
from app.models.user import MemberLeaveOfAbsence, Organization, User
from app.services.email_policy import (
    EmailKind,
    department_required_kinds,
    member_receives_email,
)
from app.services.email_theme import fact, facts
from app.services.leave_request_service import (
    MANAGE_PERMISSION,
    LeaveRequestService,
    rule_sentence,
)
from app.services.training_waiver_service import (
    SOURCE_LEAVE,
    WaiverPeriod,
    get_leave_month_rule,
    month_waivers,
)
from app.utils.org_timezone import resolve_org_today

KIND_END_REMINDER = "end_reminder"
KIND_OPEN_ENDED_DIGEST = "open_ended_digest"

# An open-ended leave is listed once it has run this long.
OPEN_ENDED_AFTER_MONTHS = 6

MY_TRAINING_PATH = "/training/my-training"
LEAVES_PATH = "/members/admin/waivers"
REQUESTS_PATH = "/members/leave-requests"


def _url(path: str) -> str:
    return f"{app_settings.FRONTEND_URL.rstrip('/')}{path}"


def _date(value: Optional[date]) -> str:
    # The format every other email date uses.
    return value.strftime("%B %d, %Y") if value else "No end date"


def _name(user: Optional[User], fallback: str = "") -> str:
    if user is None:
        return fallback
    return user.display_name or user.username or fallback


def resume_note(leave: MemberLeaveOfAbsence, rule: str) -> str:
    """When the member's requirements apply again, by the department's rule.

    Measures the leave's last month with ``month_waivers``, as the
    requirement screens do, so the email and the screen cannot disagree.
    """
    if leave.exempt_from_training_waiver:
        return (
            "Your training requirements stayed in force during this leave, so "
            "nothing about them changes when it ends."
        )
    end = leave.end_date
    if end is None:
        return ""
    month_start = end.replace(day=1)
    month_end = month_start + relativedelta(months=1) - timedelta(days=1)
    period = WaiverPeriod(
        start_date=leave.start_date,
        end_date=end,
        source=SOURCE_LEAVE,
        month_rule=rule,
    )
    excused = month_waivers([period], month_start, month_end).get((end.year, end.month))
    share = excused.share if excused else 0.0
    month = end.strftime("%B %Y")
    following = (month_start + relativedelta(months=1)).strftime("%B %Y")
    if share >= 1:
        return (
            f"Under the department's rule {month} is excused in full, so your "
            f"training requirements apply again from {following}."
        )
    if share > 0:
        return (
            f"Under the department's rule {month} is {round(share * 100)}% "
            f"excused, and your training requirements apply in full from "
            f"{following}."
        )
    return (
        f"Under the department's rule {month} is owed in full, so your "
        f"training requirements apply again from {month}."
    )


async def _claim(
    db: AsyncSession, org_id: str, kind: str, key: str
) -> Optional[LeaveNoticeSend]:
    """Take and commit the claim for one email, or ``None`` if it is taken."""
    claim = LeaveNoticeSend(organization_id=org_id, kind=kind, key=key)
    db.add(claim)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        return None
    return claim


async def _release(db: AsyncSession, claim: LeaveNoticeSend) -> None:
    await db.delete(claim)
    await db.commit()


async def _officers(
    db: AsyncSession, org_id: str, exclude: Sequence[str] = ()
) -> List[User]:
    """Current members who can record leave, with an address to email."""
    members = (
        (
            await db.execute(
                select(User)
                .options(selectinload(User.positions))
                .where(User.organization_id == org_id, User.is_active)
            )
        )
        .scalars()
        .all()
    )
    skip = {str(x) for x in exclude}
    return [
        u
        for u in members
        if u.email
        and str(u.id) not in skip
        and user_has_permission(u, MANAGE_PERMISSION)
    ]


async def _send(
    db: AsyncSession,
    org: Optional[Organization],
    user: User,
    kind: EmailKind,
    template_type: EmailTemplateType,
    context: dict,
) -> bool:
    """Send one email if the member receives this kind. Never raises."""
    if not user.email:
        return False
    if not member_receives_email(
        user.notification_preferences, kind, department_required_kinds(org)
    ):
        return False
    try:
        from app.services.email_service import EmailService

        return await EmailService(organization=org).send_leave_workflow_email(
            template_type=template_type,
            to_email=user.email,
            context=context,
            db=db,
            organization_id=str(org.id) if org else None,
        )
    except Exception as exc:
        logger.warning("Leave email {} failed: {}", template_type.value, exc)
        return False


# ----------------------------------------------------------------------
# Daily: leave ending
# ----------------------------------------------------------------------


async def send_leave_ending_reminders(db: AsyncSession, org: Organization) -> int:
    """Remind members whose leave ends within the department's window."""
    org_id = str(org.id)
    settings = await LeaveRequestService(db).get_settings(org_id)
    if settings.end_reminder_days <= 0:
        return 0
    today = await resolve_org_today(db, org_id)
    leaves = (
        (
            await db.execute(
                select(MemberLeaveOfAbsence).where(
                    MemberLeaveOfAbsence.organization_id == org_id,
                    MemberLeaveOfAbsence.active.is_(True),
                    MemberLeaveOfAbsence.end_date.is_not(None),
                    MemberLeaveOfAbsence.end_date >= today,
                    MemberLeaveOfAbsence.end_date
                    <= today + timedelta(days=settings.end_reminder_days),
                )
            )
        )
        .scalars()
        .all()
    )
    if not leaves:
        return 0
    rule = await get_leave_month_rule(db, org_id)
    sent = 0
    for leave in leaves:
        member = (
            await db.execute(
                select(User).where(
                    User.id == str(leave.user_id),
                    User.organization_id == org_id,
                    User.is_active,
                )
            )
        ).scalar_one_or_none()
        if member is None:
            continue
        # The end date is in the key, so moving it earns a new reminder.
        claim = await _claim(
            db, org_id, KIND_END_REMINDER, f"{leave.id}:{leave.end_date}"
        )
        if claim is None:
            continue
        end = _date(leave.end_date)
        delivered = await _send(
            db,
            org,
            member,
            EmailKind.TRAINING_REMINDERS,
            EmailTemplateType.LEAVE_ENDING_REMINDER,
            {
                "member_name": _name(member),
                "end_date": end,
                "resume_note": resume_note(leave, rule),
                "training_url": _url(MY_TRAINING_PATH),
            },
        )
        if settings.end_reminder_copy_officers:
            for officer in await _officers(db, org_id, exclude=[str(member.id)]):
                delivered = (
                    await _send(
                        db,
                        org,
                        officer,
                        EmailKind.MEMBERSHIP_ADMIN,
                        EmailTemplateType.LEAVE_ENDING_OFFICER_NOTICE,
                        {
                            "recipient_name": _name(officer),
                            "member_name": _name(member, "A member"),
                            "end_date": end,
                            "leaves_url": _url(LEAVES_PATH),
                        },
                    )
                    or delivered
                )
        if delivered:
            sent += 1
        else:
            # Nobody could be emailed (no mail configured, every address
            # muted): free the claim so a later run can try again.
            await _release(db, claim)
    return sent


# ----------------------------------------------------------------------
# Monthly: open-ended leaves
# ----------------------------------------------------------------------


async def send_open_ended_leave_digest(db: AsyncSession, org: Organization) -> int:
    """List long-running open-ended leaves for the officers, once a month."""
    org_id = str(org.id)
    today = await resolve_org_today(db, org_id)
    cutoff = today - relativedelta(months=OPEN_ENDED_AFTER_MONTHS)
    leaves = (
        await db.execute(
            select(MemberLeaveOfAbsence, User)
            .join(User, User.id == MemberLeaveOfAbsence.user_id)
            .where(
                MemberLeaveOfAbsence.organization_id == org_id,
                MemberLeaveOfAbsence.active.is_(True),
                MemberLeaveOfAbsence.end_date.is_(None),
                MemberLeaveOfAbsence.start_date <= cutoff,
                User.organization_id == org_id,
            )
            .order_by(MemberLeaveOfAbsence.start_date)
        )
    ).all()
    if not leaves:
        return 0
    claim = await _claim(db, org_id, KIND_OPEN_ENDED_DIGEST, today.strftime("%Y-%m"))
    if claim is None:
        return 0
    rows = [
        (_name(member, "A member"), _date(leave.start_date)) for leave, member in leaves
    ]
    leaves_html = facts(
        [
            [fact(html.escape(name), f"Since {html.escape(since)}")]
            for name, since in rows
        ]
    )
    leaves_text = "\n".join(f"- {name}, since {since}" for name, since in rows)
    sent = 0
    for officer in await _officers(db, org_id):
        if await _send(
            db,
            org,
            officer,
            EmailKind.MEMBERSHIP_ADMIN,
            EmailTemplateType.OPEN_ENDED_LEAVE_DIGEST,
            {
                "recipient_name": _name(officer),
                "leave_count": str(len(rows)),
                "leaves_html": leaves_html,
                "leaves_text": leaves_text,
                "leaves_url": _url(LEAVES_PATH),
            },
        ):
            sent += 1
    if sent == 0:
        await _release(db, claim)
    return sent


# ----------------------------------------------------------------------
# Requests
# ----------------------------------------------------------------------


async def notify_request_submitted(
    db: AsyncSession, organization_id: str, request_id: str
) -> int:
    """Email each member who may decide the request. Returns how many."""
    org_id = str(organization_id)
    request = (
        await db.execute(
            select(LeaveRequest).where(
                LeaveRequest.id == str(request_id),
                LeaveRequest.organization_id == org_id,
            )
        )
    ).scalar_one_or_none()
    if request is None or request.status != LeaveRequestStatus.PENDING:
        return 0
    member, approvers, count = await LeaveRequestService(db).requester_and_approvers(
        org_id, request
    )
    org = await db.get(Organization, org_id)
    sentence = rule_sentence(request.decision_rule, count)
    sent = 0
    for approver in approvers:
        if await _send(
            db,
            org,
            approver,
            EmailKind.MEMBERSHIP_ADMIN,
            EmailTemplateType.LEAVE_REQUEST_SUBMITTED,
            {
                "recipient_name": _name(approver),
                "member_name": _name(member, "A member"),
                "start_date": _date(request.start_date),
                "end_date": _date(request.end_date),
                "reason_provided": "Yes" if request.reason else "No",
                "rule_sentence": sentence,
                "request_url": _url(REQUESTS_PATH),
            },
        ):
            sent += 1
    return sent


async def notify_request_denied(
    db: AsyncSession, organization_id: str, request_id: str, note: Optional[str]
) -> bool:
    """Email the member that their request was denied."""
    org_id = str(organization_id)
    request = (
        await db.execute(
            select(LeaveRequest).where(
                LeaveRequest.id == str(request_id),
                LeaveRequest.organization_id == org_id,
            )
        )
    ).scalar_one_or_none()
    if request is None or request.status != LeaveRequestStatus.DENIED:
        return False
    users = {
        str(u.id): u
        for u in (
            await db.execute(
                select(User).where(
                    User.id.in_([str(request.user_id), str(request.decided_by or "")]),
                    User.organization_id == org_id,
                )
            )
        )
        .scalars()
        .all()
    }
    member = users.get(str(request.user_id))
    if member is None or not member.is_active:
        return False
    org = await db.get(Organization, org_id)
    return await _send(
        db,
        org,
        member,
        EmailKind.TRAINING_RECORD_CHANGES,
        EmailTemplateType.LEAVE_REQUEST_DENIED,
        {
            "member_name": _name(member),
            "start_date": _date(request.start_date),
            "end_date": _date(request.end_date),
            "decided_by": _name(users.get(str(request.decided_by)), "An approver"),
            "decision_note": note or "None",
            "request_url": _url(REQUESTS_PATH),
        },
    )


async def send_request_submitted(organization_id: str, request_id: str) -> None:
    """Background task: ``notify_request_submitted`` on its own session."""
    from app.core.database import database_manager

    try:
        async for session in database_manager.get_session():
            await notify_request_submitted(session, organization_id, request_id)
    except Exception as exc:  # pragma: no cover - defensive
        logger.warning("Leave request notice failed: {}", exc)


async def send_request_denied(
    organization_id: str, request_id: str, note: Optional[str]
) -> None:
    """Background task: ``notify_request_denied`` on its own session."""
    from app.core.database import database_manager

    try:
        async for session in database_manager.get_session():
            await notify_request_denied(session, organization_id, request_id, note)
    except Exception as exc:  # pragma: no cover - defensive
        logger.warning("Leave request decision notice failed: {}", exc)
