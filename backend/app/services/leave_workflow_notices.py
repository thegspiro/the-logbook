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


# ----------------------------------------------------------------------
# The request conversation, the undecided-request reminder and the recheck
# (2026-11-16)
#
# Each of these is an email and a bell notice (owner decision 2026-11-16).
# Neither carries a question or an answer: the reader opens the request.
# ----------------------------------------------------------------------

KIND_REQUEST_REMINDER = "request_reminder"
BELL_CATEGORY = "leave_request"

# The first reminder waits this long after the request; later ones follow
# weekly while it still waits.
FIRST_REMINDER_DAYS = 3
REMINDER_EVERY_DAYS = 7

QUESTION_ASKED = "question_asked"
CHANGES_PROPOSED = "changes_proposed"
ANSWERED = "answered"
CHANGES_ACCEPTED = "changes_accepted"
CHANGES_DECLINED = "changes_declined"


def _bell(
    db: AsyncSession,
    org_id: str,
    user: User,
    subject: str,
    message: str,
    request_id: str,
    action_path: str = REQUESTS_PATH,
    metadata_key: str = "leave_request_id",
) -> None:
    """Queue an in-app notice; committed with the caller's next commit."""
    from app.models.notification import NotificationChannel, NotificationLog

    db.add(
        NotificationLog(
            organization_id=org_id,
            recipient_id=str(user.id),
            channel=NotificationChannel.IN_APP,
            category=BELL_CATEGORY,
            subject=subject,
            message=message,
            action_url=action_path,
            notification_metadata={metadata_key: request_id},
            delivered=True,
        )
    )


async def _commit_bells(db: AsyncSession) -> None:
    try:
        await db.commit()
    except Exception as exc:
        # The email still carries the notice; a failed bell insert must not
        # take it down too.
        await db.rollback()
        logger.warning("Leave request in-app notice failed: {}", exc)


async def _request(db: AsyncSession, org_id: str, request_id: str):
    return (
        await db.execute(
            select(LeaveRequest).where(
                LeaveRequest.id == str(request_id),
                LeaveRequest.organization_id == org_id,
            )
        )
    ).scalar_one_or_none()


async def notify_request_event(
    db: AsyncSession,
    organization_id: str,
    request_id: str,
    event: str,
    actor_id: str,
) -> int:
    """Tell whoever must act next. Returns how many were emailed.

    A question or changed dates go to the member, who must answer before
    voting resumes; the member's answer, or their decision on the dates, goes
    to the approvers.
    """
    org_id = str(organization_id)
    request = await _request(db, org_id, request_id)
    if request is None or request.status != LeaveRequestStatus.PENDING:
        return 0
    service = LeaveRequestService(db)
    member, approvers, _ = await service.requester_and_approvers(org_id, request)
    if member is None:
        return 0
    actor = await db.get(User, str(actor_id))
    actor_name = _name(actor, "An approver")
    org = await db.get(Organization, org_id)
    member_name = _name(member, "A member")
    sent = 0
    rid = str(request.id)

    if event in (QUESTION_ASKED, CHANGES_PROPOSED):
        if event == QUESTION_ASKED:
            summary = (
                f"{actor_name} asked you a question about your request for "
                "leave. Open the request to read it and answer."
            )
            start, end = request.start_date, request.end_date
            subject = "A question about your leave request"
        else:
            summary = (
                f"{actor_name} would approve your request for leave with "
                "different dates. Open the request to accept or decline them."
            )
            start = request.proposed_start_date or request.start_date
            end = request.proposed_end_date
            subject = "Changed dates for your leave request"
        _bell(db, org_id, member, subject, summary, rid)
        await _commit_bells(db)
        if await _send(
            db,
            org,
            member,
            EmailKind.TRAINING_RECORD_CHANGES,
            EmailTemplateType.LEAVE_REQUEST_FOR_MEMBER,
            {
                "member_name": member_name,
                "summary": summary,
                "start_date": _date(start),
                "end_date": _date(end),
                "request_url": _url(REQUESTS_PATH),
            },
        ):
            sent += 1
        return sent

    summaries = {
        ANSWERED: (
            f"{member_name} answered the question on their request for leave. "
            "Voting can resume."
        ),
        CHANGES_ACCEPTED: (
            f"{member_name} accepted the changed dates on their request for "
            "leave. Voting starts again on the new dates."
        ),
        CHANGES_DECLINED: (
            f"{member_name} declined the changed dates on their request for "
            "leave. Their own dates stand, and voting can resume."
        ),
    }
    approver_summary = summaries.get(event)
    if approver_summary is None:
        raise ValueError(f"Unknown leave request event: {event}")
    for approver in approvers:
        _bell(
            db, org_id, approver, f"Leave request: {member_name}", approver_summary, rid
        )
    await _commit_bells(db)
    for approver in approvers:
        if await _send(
            db,
            org,
            approver,
            EmailKind.MEMBERSHIP_ADMIN,
            EmailTemplateType.LEAVE_REQUEST_UPDATE,
            {
                "recipient_name": _name(approver),
                "member_name": member_name,
                "summary": approver_summary,
                "request_url": _url(REQUESTS_PATH),
            },
        ):
            sent += 1
    return sent


async def send_request_event(
    organization_id: str, request_id: str, event: str, actor_id: str
) -> None:
    """Background task: ``notify_request_event`` on its own session."""
    from app.core.database import database_manager

    try:
        async for session in database_manager.get_session():
            await notify_request_event(
                session, organization_id, request_id, event, actor_id
            )
    except Exception as exc:  # pragma: no cover - defensive
        logger.warning("Leave request notice failed: {}", exc)


def reminder_number(created: date, today: date) -> int:
    """Which reminder is due by ``today`` for a request made on ``created``.

    0 before the first (three days after), then 1, 2, ... one a week. Each
    number is claimed once, so a daily run sends each reminder exactly once.
    """
    waited = (today - created).days
    if waited < FIRST_REMINDER_DAYS:
        return 0
    return 1 + (waited - FIRST_REMINDER_DAYS) // REMINDER_EVERY_DAYS


async def send_request_reminders(db: AsyncSession, org: Organization) -> int:
    """Remind approvers who have not decided a request still waiting.

    A request waiting on its member is not reminded about: the approvers can
    do nothing until the member answers.
    """
    org_id = str(org.id)
    today = await resolve_org_today(db, org_id)
    waiting = (
        (
            await db.execute(
                select(LeaveRequest).where(
                    LeaveRequest.organization_id == org_id,
                    LeaveRequest.status == LeaveRequestStatus.PENDING,
                    LeaveRequest.info_requested_at.is_(None),
                    LeaveRequest.proposed_at.is_(None),
                )
            )
        )
        .scalars()
        .all()
    )
    service = LeaveRequestService(db)
    sent = 0
    for request in waiting:
        created = request.created_at.date()
        number = reminder_number(created, today)
        if number == 0:
            continue
        owing = await service.waiting_on_ids(org_id, request)
        member, approvers, count = await service.requester_and_approvers(
            org_id, request
        )
        due = [a for a in approvers if str(a.id) in owing]
        if not due:
            continue
        claim = await _claim(
            db, org_id, KIND_REQUEST_REMINDER, f"{request.id}:{number}"
        )
        if claim is None:
            continue
        member_name = _name(member, "A member")
        waited = (today - created).days
        for approver in due:
            _bell(
                db,
                org_id,
                approver,
                f"Waiting on your decision: {member_name}",
                f"{member_name}'s request for leave has waited {waited} days.",
                str(request.id),
            )
        await _commit_bells(db)
        delivered = False
        for approver in due:
            delivered = (
                await _send(
                    db,
                    org,
                    approver,
                    EmailKind.MEMBERSHIP_ADMIN,
                    EmailTemplateType.LEAVE_REQUEST_REMINDER,
                    {
                        "recipient_name": _name(approver),
                        "member_name": member_name,
                        "waiting_days": str(waited),
                        "start_date": _date(request.start_date),
                        "end_date": _date(request.end_date),
                        "rule_sentence": rule_sentence(request.decision_rule, count),
                        "request_url": _url(REQUESTS_PATH),
                    },
                )
                or delivered
            )
        # The bell notices went out whatever the email did, so the claim
        # stands: releasing it would put a second bell notice on tomorrow's run.
        sent += 1 if delivered else 0
    return sent


KIND_REQUEST_ESCALATION = "request_escalation"


def _names(users: Sequence[User]) -> str:
    """'A', 'A and B', 'A, B and C'."""
    names = [_name(u, "an approver") for u in users]
    if len(names) <= 1:
        return "".join(names)
    return f"{', '.join(names[:-1])} and {names[-1]}"


def waiting_on_sentence(
    request: LeaveRequest, member_name: str, undecided: Sequence[User]
) -> str:
    """Who a waiting request is waiting on, for the escalation."""
    if request.info_requested_at is not None:
        return f"It is waiting on {member_name} to answer an approver's question."
    if request.proposed_at is not None:
        return (
            f"It is waiting on {member_name} to accept or decline changed dates "
            "an approver proposed."
        )
    if undecided:
        return f"It is waiting on {_names(undecided)} to decide."
    return "It is waiting on the department's approvers to decide."


async def send_request_escalations(db: AsyncSession, org: Organization) -> int:
    """Tell the Chief, once, about each request undecided past the limit.

    Reminders go to the approvers; this goes over their heads, so it is sent
    once per request rather than weekly. Measured from the day the request
    was made, whatever it is waiting on. Claimed before it is sent, and the
    claim kept once a bell notice went out (pitfall #36).
    """
    org_id = str(org.id)
    service = LeaveRequestService(db)
    limit = (await service.get_settings(org_id)).request_escalation_days
    if limit <= 0:
        return 0
    today = await resolve_org_today(db, org_id)
    waiting = (
        (
            await db.execute(
                select(LeaveRequest)
                .where(
                    LeaveRequest.organization_id == org_id,
                    LeaveRequest.status == LeaveRequestStatus.PENDING,
                )
                .order_by(LeaveRequest.created_at)
            )
        )
        .scalars()
        .all()
    )
    sent = 0
    for request in waiting:
        waited = (today - request.created_at.date()).days
        if waited < limit:
            continue
        recipients = await service.escalation_recipients(org_id, request)
        if not recipients:
            continue
        claim = await _claim(db, org_id, KIND_REQUEST_ESCALATION, str(request.id))
        if claim is None:
            continue
        owing = await service.waiting_on_ids(org_id, request)
        member, approvers, _ = await service.requester_and_approvers(org_id, request)
        member_name = _name(member, "A member")
        undecided = sorted(
            (a for a in approvers if str(a.id) in owing),
            key=lambda u: _name(u).lower(),
        )
        waiting_on = waiting_on_sentence(request, member_name, undecided)
        for recipient in recipients:
            _bell(
                db,
                org_id,
                recipient,
                f"Undecided for {waited} days: {member_name}",
                f"{member_name}'s request for leave has waited {waited} days. "
                f"{waiting_on}",
                str(request.id),
            )
        await _commit_bells(db)
        delivered = False
        for recipient in recipients:
            delivered = (
                await _send(
                    db,
                    org,
                    recipient,
                    EmailKind.MEMBERSHIP_ADMIN,
                    EmailTemplateType.LEAVE_REQUEST_ESCALATION,
                    {
                        "recipient_name": _name(recipient),
                        "member_name": member_name,
                        "waiting_days": str(waited),
                        "start_date": _date(request.start_date),
                        "end_date": _date(request.end_date),
                        "waiting_on": waiting_on,
                        "request_url": _url(REQUESTS_PATH),
                    },
                )
                or delivered
            )
        sent += 1 if delivered else 0
    return sent


async def run_request_upkeep(db: AsyncSession, org: Organization) -> int:
    """The daily pass: settle what the rule already decides, then remind.

    A request a departed approver left decided is settled and its member told,
    as a vote would have; the rest that still wait are reminded about.
    """
    from app.services.leave_of_absence_notices import (
        RECORDED,
        UPDATED,
        deliver_leave_notice,
    )

    org_id = str(org.id)
    service = LeaveRequestService(db)
    done = 0
    for request in await service.resettle_pending(org_id):
        done += 1
        if request.status == LeaveRequestStatus.APPROVED and request.leave_id:
            extended = request.extends_leave_id == request.leave_id
            await deliver_leave_notice(
                db,
                org_id,
                str(request.leave_id),
                str(request.decided_by or ""),
                UPDATED if extended else RECORDED,
                summary=(
                    "Your request to extend your leave was approved."
                    if extended
                    else "Your request for a leave of absence was approved."
                ),
            )
        elif request.status == LeaveRequestStatus.DENIED:
            await notify_request_denied(db, org_id, str(request.id), None)
    reminded = await send_request_reminders(db, org)
    return done + reminded + await send_request_escalations(db, org)


# ----------------------------------------------------------------------
# A member ending their own leave early (2026-11-17)
# ----------------------------------------------------------------------


async def notify_leave_ended_early(
    db: AsyncSession,
    organization_id: str,
    leave_id: str,
    previous_end: Optional[date],
) -> int:
    """Tell the officers who manage leave that a member ended theirs early.

    An email and a bell notice to each, never the member themself (they made
    the change). Neither carries the leave's reason or type. Returns how many
    were emailed.
    """
    org_id = str(organization_id)
    leave = (
        await db.execute(
            select(MemberLeaveOfAbsence).where(
                MemberLeaveOfAbsence.id == str(leave_id),
                MemberLeaveOfAbsence.organization_id == org_id,
            )
        )
    ).scalar_one_or_none()
    if leave is None or leave.end_date is None:
        return 0
    member = (
        await db.execute(
            select(User).where(
                User.id == str(leave.user_id), User.organization_id == org_id
            )
        )
    ).scalar_one_or_none()
    member_name = _name(member, "A member")
    first_day_back = leave.end_date + timedelta(days=1)
    officers = await _officers(db, org_id, exclude=[str(leave.user_id)])
    for officer in officers:
        _bell(
            db,
            org_id,
            officer,
            f"{member_name} ended their leave early",
            f"{member_name} set the end of their own leave. Their first day "
            f"back is {_date(first_day_back)}.",
            str(leave.id),
            action_path=LEAVES_PATH,
            metadata_key="leave_id",
        )
    await _commit_bells(db)
    org = await db.get(Organization, org_id)
    sent = 0
    for officer in officers:
        if await _send(
            db,
            org,
            officer,
            EmailKind.MEMBERSHIP_ADMIN,
            EmailTemplateType.LEAVE_ENDED_EARLY,
            {
                "recipient_name": _name(officer),
                "member_name": member_name,
                "start_date": _date(leave.start_date),
                "previous_end_date": _date(previous_end),
                "end_date": _date(leave.end_date),
                "first_day_back": _date(first_day_back),
                "leaves_url": _url(LEAVES_PATH),
            },
        ):
            sent += 1
    return sent


async def send_leave_ended_early(
    organization_id: str, leave_id: str, previous_end: Optional[date]
) -> None:
    """Background task: ``notify_leave_ended_early`` on its own session."""
    from app.core.database import database_manager

    try:
        async for session in database_manager.get_session():
            await notify_leave_ended_early(
                session, organization_id, leave_id, previous_end
            )
    except Exception as exc:  # pragma: no cover - defensive
        logger.warning("Leave ended early notice failed: {}", exc)
