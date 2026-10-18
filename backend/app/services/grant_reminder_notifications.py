"""Daily email reminders for grant compliance tasks and pledges.

Two reminders, both **email only**, both sent by the ``grant_reminders``
scheduled task:

==================  ==============================================  ============
Reminder            Recipients                                      When
==================  ==============================================  ============
Compliance task     the task's assignee, when they are an active    see below
                    member of the department who can open Grants
                    & Fundraising; otherwise the active
                    ``fundraising.manage`` holders
Pledge coming due   the active ``fundraising.manage`` holders —     see below
                    never the donor
==================  ==============================================  ============

**Compliance task.** Two reminders per task and due date. The *advance*
reminder is due from ``reminder_days_before`` days before the due date (the
per-task number the task form sets, 14 by default; 0 turns it off). The
*due* reminder is due on the due date, and — so a report nobody finished is
not left unmentioned — on any run up to :data:`OVERDUE_CATCH_UP_DAYS` days
after it. The catch-up limit keeps the first run after an upgrade from
emailing about every open task that went overdue years ago. Once the due
reminder's window begins the advance one is skipped. Only open tasks are
reminded: completed and waived ones never are.

**Pledge.** Reminders :data:`PLEDGE_OFFSETS_DAYS` days before the due date,
the most urgent window that has begun, the way the budget-request reminder
picks its offset (``finance_budget_request_notifications.due_offset``).
Only a pledge with its reminder switch on, a due date, a status that is
still open (not fulfilled or cancelled) and money still outstanding is
reminded. Nothing goes to the donor: the reminder tells the people who
manage fundraising to follow up, and how and whether to contact a donor is
theirs to decide.

Never SMS, and no bell entry: these are administrative deadlines days away
(CLAUDE.md pitfall #18), and the Grants screens already list them. Both use
the optional :attr:`EmailKind.FUNDRAISING_DUTIES` kind, so a member can turn
them off and a department can make them required. A department that has the
Grants & Fundraising module switched off is sent nothing, since every link
in these emails would be refused.

**Idempotency.** The scheduler runs this daily and again whenever it
restarts. Each reminder sent is recorded as an email-channel
``NotificationLog`` row whose metadata names the task or pledge, its due
date and the reminder; a member already recorded for that combination is
not sent it again. The due date is part of the key, so moving it starts a
fresh set. ``last_reminder_sent`` on the task or pledge is stamped as well,
for the screens; the sent-log, not that column, decides what is sent.

Every query is constrained to the organization (pitfall #14): a compliance
task has no ``organization_id`` of its own and is reached through its grant
application's.
"""

from __future__ import annotations

import html
from datetime import date, datetime, timezone
from decimal import Decimal
from typing import Iterable, Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.grant import (
    ComplianceTaskStatus,
    Donor,
    FundraisingCampaign,
    GrantApplication,
    GrantComplianceTask,
    GrantOpportunity,
    Pledge,
    PledgeStatus,
)
from app.models.notification import NotificationChannel, NotificationLog
from app.models.user import Organization, User
from app.services.email_policy import (
    EmailKind,
    department_required_kinds,
    member_receives_email,
)
from app.services.email_theme import ACCENT_AMBER, ACCENT_BLUE, action, fact, facts
from app.utils.org_timezone import org_today

GRANTS_MODULE = "grants"
PLEDGES_PATH = "/grants/pledges"

# Days after a task's due date the due reminder may still go out (module
# docstring).
OVERDUE_CATCH_UP_DAYS = 7

# Days before a pledge's due date a reminder goes out. Constants, as the
# budget-request reminder's are: a pledge has only an on/off switch, and a
# settings section for two numbers is more surface than the reminder is worth.
PLEDGE_OFFSETS_DAYS = (14, 1)

TASK_LOG_CATEGORY = "grant_task_reminder"
PLEDGE_LOG_CATEGORY = "pledge_reminder"

STAGE_ADVANCE = "advance"
STAGE_DUE = "due"

_CLOSED_TASK = (ComplianceTaskStatus.COMPLETED, ComplianceTaskStatus.WAIVED)
_OPEN_PLEDGE = (PledgeStatus.PENDING, PledgeStatus.PARTIAL, PledgeStatus.OVERDUE)


# ============================================
# Which reminder is due
# ============================================


def task_stage(due: date, today: date, advance_days: int) -> Optional[str]:
    """The compliance-task reminder whose window has begun, if any."""
    days_left = (due - today).days
    if days_left < -OVERDUE_CATCH_UP_DAYS:
        return None
    if days_left <= 0:
        return STAGE_DUE
    if advance_days > 0 and days_left <= advance_days:
        return STAGE_ADVANCE
    return None


def pledge_offset(due: date, today: date) -> Optional[int]:
    """The pledge reminder whose window has begun, the most urgent first.

    ``None`` before the first window and after the due date.
    """
    days_left = (due - today).days
    if days_left < 0:
        return None
    due_now = [offset for offset in PLEDGE_OFFSETS_DAYS if days_left <= offset]
    return min(due_now) if due_now else None


# ============================================
# Formatting
# ============================================


def money(value) -> str:
    amount = Decimal(value or 0).quantize(Decimal("0.01"))
    return f"${amount:,.2f}"


def long_date(value: date) -> str:
    return f"{value:%B} {value.day}, {value.year}"


def _when(days_left: int) -> str:
    if days_left < 0:
        days = -days_left
        return f"was due {days} day{'s' if days != 1 else ''} ago"
    return {0: "is due today", 1: "is due tomorrow"}.get(
        days_left, f"is due in {days_left} days"
    )


def _subject_safe(text: str) -> str:
    # A subject is a header: a line break in a task title would end it.
    return " ".join((text or "").split())


def _link(path: str) -> str:
    return f"{settings.FRONTEND_URL.rstrip('/')}{path}"


def _donor_name(donor: Optional[Donor]) -> str:
    """The same label the Pledges screen shows (``donorDisplayName``)."""
    if donor is None:
        return "A donor not in the directory"
    name = f"{donor.first_name or ''} {donor.last_name or ''}".strip()
    if donor.company_name:
        return f"{name} ({donor.company_name})" if name else donor.company_name
    return name or "Unnamed donor"


# ============================================
# Recipients
# ============================================


async def _active_members(db: AsyncSession, org_id: str) -> list[User]:
    from app.services.finance_approver_matching import ApproverDirectory

    return await ApproverDirectory(db, org_id).active_members()


def _managers(members: Iterable[User]) -> list[User]:
    from app.api.dependencies import user_has_permission

    return [m for m in members if user_has_permission(m, "fundraising.manage")]


def _can_open_grants(user: User) -> bool:
    from app.api.dependencies import user_has_permission

    return user_has_permission(user, "fundraising.view") or user_has_permission(
        user, "fundraising.manage"
    )


def _who_receive(users: Iterable[User], org: Organization) -> list[User]:
    required = department_required_kinds(org)
    seen: set[str] = set()
    out = []
    for user in users:
        key = str(user.id)
        if key in seen or not user.email:
            continue
        seen.add(key)
        if member_receives_email(
            user.notification_preferences, EmailKind.FUNDRAISING_DUTIES, required
        ):
            out.append(user)
    return out


def _task_recipients(
    task: GrantComplianceTask, members_by_id: dict[str, User], managers: list[User]
) -> list[User]:
    """The assignee when they can act on it, else the fundraising managers.

    ``members_by_id`` holds only the department's active members, so an
    assignee who left, was deactivated or belongs to another department
    falls through to the managers rather than going unreminded.
    """
    assignee = members_by_id.get(str(task.assigned_to)) if task.assigned_to else None
    if assignee is not None and assignee.email and _can_open_grants(assignee):
        return [assignee]
    return managers


# ============================================
# Sending and the sent-log
# ============================================


async def _send(
    db: AsyncSession,
    org: Organization,
    users: list[User],
    *,
    subject: str,
    title: str,
    body_html: str,
    text_body: str,
    chip: str,
    accent: str,
    template_type: str,
) -> list[User]:
    """Email ``users`` one message each; return the ones the mailer accepted."""
    if not users:
        return []
    from app.services.email_service import EmailService, wrap_email_body

    html_body = wrap_email_body(org, title, body_html, header_color=accent, chip=chip)
    results: list[bool] = []
    sent, _failed = await EmailService(organization=org).send_email(
        to_emails=[u.email for u in users],
        subject=_subject_safe(subject),
        html_body=html_body,
        text_body=text_body,
        db=db,
        template_type=template_type,
        results_out=results,
    )
    if len(results) == len(users):
        return [u for u, ok in zip(users, results) if ok]
    return list(users) if sent == len(users) else []


async def _sent_keys(
    db: AsyncSession, org_id: str, category: str
) -> set[tuple[str, str, str, str]]:
    """(entity id, due date, reminder, member id) for every reminder recorded."""
    result = await db.execute(
        select(
            NotificationLog.recipient_id, NotificationLog.notification_metadata
        ).where(
            NotificationLog.organization_id == org_id,
            NotificationLog.channel == NotificationChannel.EMAIL,
            NotificationLog.category == category,
        )
    )
    keys: set[tuple[str, str, str, str]] = set()
    for recipient_id, meta in result.all():
        if not recipient_id or not isinstance(meta, dict):
            continue
        keys.add(
            (
                str(meta.get("entity_id")),
                str(meta.get("due_date")),
                str(meta.get("reminder")),
                str(recipient_id),
            )
        )
    return keys


def _record(
    db: AsyncSession,
    org_id: str,
    users: list[User],
    *,
    category: str,
    subject: str,
    action_url: str,
    metadata: dict,
) -> None:
    for user in users:
        db.add(
            NotificationLog(
                organization_id=org_id,
                recipient_id=str(user.id),
                recipient_email=user.email,
                channel=NotificationChannel.EMAIL,
                category=category,
                subject=_subject_safe(subject)[:500],
                action_url=action_url,
                delivered=True,
                notification_metadata=dict(metadata),
            )
        )


# ============================================
# Compliance tasks
# ============================================


def _grant_label(application: GrantApplication, opportunity_name: Optional[str]) -> str:
    return (
        opportunity_name
        or application.grant_program_name
        or application.grant_agency
        or "Grant application"
    )


async def _task_reminders(
    db: AsyncSession,
    org: Organization,
    today: date,
    members_by_id: dict[str, User],
    managers: list[User],
) -> int:
    org_id = str(org.id)
    rows = await db.execute(
        select(GrantComplianceTask, GrantApplication, GrantOpportunity.name)
        .join(
            GrantApplication,
            GrantApplication.id == GrantComplianceTask.application_id,
        )
        .outerjoin(
            GrantOpportunity,
            (GrantOpportunity.id == GrantApplication.opportunity_id)
            & (GrantOpportunity.organization_id == org_id),
        )
        .where(
            GrantApplication.organization_id == org_id,
            GrantComplianceTask.status.notin_(_CLOSED_TASK),
        )
    )
    candidates = []
    for task, application, opportunity_name in rows.all():
        stage = task_stage(task.due_date, today, task.reminder_days_before or 0)
        if stage is not None:
            candidates.append((task, application, opportunity_name, stage))
    if not candidates:
        return 0

    told = await _sent_keys(db, org_id, TASK_LOG_CATEGORY)
    total = 0
    for task, application, opportunity_name, stage in candidates:
        due_iso = task.due_date.isoformat()
        recipients = _who_receive(
            (
                u
                for u in _task_recipients(task, members_by_id, managers)
                if (str(task.id), due_iso, stage, str(u.id)) not in told
            ),
            org,
        )
        if not recipients:
            continue
        days_left = (task.due_date - today).days
        grant = _grant_label(application, opportunity_name)
        due_text = long_date(task.due_date)
        path = f"/grants/applications/{application.id}"
        link = _link(path)
        if days_left < 0:
            subject = f"Overdue grant task: {task.title}"
            title = "Grant task overdue"
        elif days_left == 0:
            subject = f"Grant task due today: {task.title}"
            title = "Grant task due today"
        else:
            subject = f"Grant task due {due_text}: {task.title}"
            title = "Grant task due soon"
        lead = f"The compliance task “{task.title}” for {grant} {_when(days_left)}."
        body = (
            f"<p>{html.escape(lead)}</p>"
            + facts(
                [
                    [fact("Task", html.escape(task.title))],
                    [
                        fact("Grant", html.escape(grant)),
                        fact("Due", html.escape(due_text)),
                    ],
                ]
            )
            + action(html.escape(link), "Open the grant")
        )
        text = (
            f"{lead}\n\nTask: {task.title}\nGrant: {grant}\nDue: {due_text}\n\n"
            f"Open the grant: {link}\n"
        )
        sent = await _send(
            db,
            org,
            recipients,
            subject=subject,
            title=title,
            body_html=body,
            text_body=text,
            chip="Grant compliance",
            accent=ACCENT_AMBER if days_left <= 0 else ACCENT_BLUE,
            template_type="grant_compliance_task_reminder",
        )
        if not sent:
            continue
        _record(
            db,
            org_id,
            sent,
            category=TASK_LOG_CATEGORY,
            subject=subject,
            action_url=path,
            metadata={
                "entity_id": str(task.id),
                "due_date": due_iso,
                "reminder": stage,
                "org_date": today.isoformat(),
            },
        )
        task.last_reminder_sent = datetime.now(timezone.utc)
        total += len(sent)
    return total


# ============================================
# Pledges
# ============================================


async def _pledge_reminders(
    db: AsyncSession, org: Organization, today: date, managers: list[User]
) -> int:
    org_id = str(org.id)
    if not managers:
        return 0
    rows = await db.execute(
        select(Pledge, Donor, FundraisingCampaign.name)
        .outerjoin(
            Donor,
            (Donor.id == Pledge.donor_id) & (Donor.organization_id == org_id),
        )
        .outerjoin(
            FundraisingCampaign,
            (FundraisingCampaign.id == Pledge.campaign_id)
            & (FundraisingCampaign.organization_id == org_id),
        )
        .where(
            Pledge.organization_id == org_id,
            Pledge.reminder_enabled.is_(True),
            Pledge.status.in_(_OPEN_PLEDGE),
            Pledge.due_date.isnot(None),
            Pledge.due_date >= today,
        )
    )
    candidates = []
    for pledge, donor, campaign_name in rows.all():
        due = pledge.due_date
        if due is None:
            continue
        outstanding = Decimal(pledge.pledged_amount or 0) - Decimal(
            pledge.fulfilled_amount or 0
        )
        if outstanding <= 0:
            continue
        offset = pledge_offset(due, today)
        if offset is not None:
            candidates.append((pledge, due, donor, campaign_name, outstanding, offset))
    if not candidates:
        return 0

    told = await _sent_keys(db, org_id, PLEDGE_LOG_CATEGORY)
    link = _link(PLEDGES_PATH)
    total = 0
    for pledge, due, donor, campaign_name, outstanding, offset in candidates:
        due_iso = due.isoformat()
        recipients = _who_receive(
            (
                u
                for u in managers
                if (str(pledge.id), due_iso, str(offset), str(u.id)) not in told
            ),
            org,
        )
        if not recipients:
            continue
        donor_name = _donor_name(donor)
        due_text = long_date(due)
        days_left = (due - today).days
        subject = (
            f"Pledge due {due_text}: {donor_name} ({money(outstanding)} outstanding)"
        )
        lead = (
            f"A pledge from {donor_name} {_when(days_left)}, with "
            f"{money(outstanding)} of {money(pledge.pledged_amount)} still to "
            "be received."
        )
        rows_html = [
            [
                fact("Donor", html.escape(donor_name)),
                fact("Due", html.escape(due_text)),
            ],
            [
                fact("Pledged", html.escape(money(pledge.pledged_amount))),
                fact("Outstanding", html.escape(money(outstanding))),
            ],
        ]
        if campaign_name:
            rows_html.append([fact("Campaign", html.escape(campaign_name))])
        body = (
            f"<p>{html.escape(lead)}</p>"
            + facts(rows_html)
            + action(html.escape(link), "Open pledges")
        )
        text = (
            f"{lead}\n\nDonor: {donor_name}\nDue: {due_text}\n"
            + (f"Campaign: {campaign_name}\n" if campaign_name else "")
            + f"\nOpen pledges: {link}\n"
        )
        sent = await _send(
            db,
            org,
            recipients,
            subject=subject,
            title="Pledge coming due",
            body_html=body,
            text_body=text,
            chip="Fundraising",
            accent=ACCENT_BLUE,
            template_type="pledge_reminder",
        )
        if not sent:
            continue
        _record(
            db,
            org_id,
            sent,
            category=PLEDGE_LOG_CATEGORY,
            subject=subject,
            action_url=PLEDGES_PATH,
            metadata={
                "entity_id": str(pledge.id),
                "due_date": due_iso,
                "reminder": str(offset),
                "org_date": today.isoformat(),
            },
        )
        pledge.last_reminder_sent = datetime.now(timezone.utc)
        total += len(sent)
    return total


# ============================================
# Entry point (scheduled)
# ============================================


async def _grants_enabled(db: AsyncSession, org: Organization) -> bool:
    from app.services.organization_service import OrganizationService

    enabled = await OrganizationService(db).get_enabled_modules(str(org.id))
    return GRANTS_MODULE in enabled.enabled_modules


async def send_grant_reminders(db: AsyncSession, org: Organization) -> int:
    """One department's compliance-task and pledge reminders for today.

    Returns the number of emails sent. Commits once, after the department is
    done, so the sent-log and the sends agree; the scheduler's per-org guard
    rolls back a failure.
    """
    if not await _grants_enabled(db, org):
        return 0
    org_id = str(org.id)
    today = org_today(org)
    members = await _active_members(db, org_id)
    members_by_id = {str(m.id): m for m in members}
    managers = _managers(members)
    total = await _task_reminders(db, org, today, members_by_id, managers)
    total += await _pledge_reminders(db, org, today, managers)
    await db.commit()
    return total
