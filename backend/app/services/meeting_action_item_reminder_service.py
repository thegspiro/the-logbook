"""Email reminders for action items recorded on a meeting record.

``run_action_item_reminders`` puts a bell entry in front of an item's assignee
three days and one day before it is due, on the day, and the day after. Those
were bell-only, at odds with email being the channel of record (CLAUDE.md
pitfall #18); the owner decided on 2026-11-01 that they are emailed as well,
and that a member can switch them off. They come under
``EmailKind.MINUTES_ACTION_ITEMS`` ("Action items from meetings and
minutes"), so the switch a member already has for minutes action items covers
them too, and a department that made that kind required has made these
required.

Action items on *minutes* are not emailed from here: ``MinutesReminderService``
emails those on adopted minutes on the department's own schedule, and a
draft's items are not yet a commitment. Emailing them here as well would mail
the same item twice on different schedules.

**Safe to run twice (pitfall #36).** ``meeting_action_items.reminder_emailed_on``
holds the department-local day an item's reminder went out; an item already
stamped with today is not selected, so a second run that day sends nothing.
The order is *send, then stamp and commit*: a crash between the two sends the
reminder again on the next run that day (at least once), which for a reminder
is a nuisance rather than harm. Two workers running the task at once are kept
apart by the scheduler claim, not by this column.

A failed send is logged and leaves the items unstamped, so a later run retries
them; one bad address never stops the rest of the department's reminders.
"""

import html
from collections import defaultdict
from dataclasses import dataclass
from datetime import date
from typing import Dict, List, Sequence, Tuple

from loguru import logger
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings as app_settings
from app.models.email_template import EmailTemplateType
from app.models.meeting import ActionItemStatus, Meeting, MeetingActionItem
from app.models.user import Organization, User
from app.services.email_policy import (
    EmailKind,
    department_required_kinds,
    recipients_for,
)
from app.services.email_service import EmailService

OPEN_STATUSES = (ActionItemStatus.OPEN.value, ActionItemStatus.IN_PROGRESS.value)


@dataclass(frozen=True)
class OwedReminder:
    """An item the bell reminded about this run, as plain values.

    Plain values because the task commits its bell entries before the emails
    go out, and the ORM rows it read are not safe to touch after that.
    """

    item_id: str
    organization_id: str
    days_until: int
    today: date


def urgency(days_until: int) -> str:
    if days_until < 0:
        return "overdue"
    if days_until == 0:
        return "due today"
    if days_until == 1:
        return "due tomorrow"
    return f"due in {days_until} days"


async def send_meeting_action_item_emails(
    db: AsyncSession, owed: Sequence[OwedReminder]
) -> int:
    """Email each assignee the items owed a reminder today; returns emails sent."""
    by_org: Dict[str, List[OwedReminder]] = defaultdict(list)
    for reminder in owed:
        by_org[reminder.organization_id].append(reminder)

    sent_total = 0
    for org_id, reminders in by_org.items():
        try:
            sent_total += await _send_for_org(db, org_id, reminders)
        except Exception as exc:
            await db.rollback()
            logger.error(
                "Meeting action item reminder emails failed for org {}: {}",
                org_id,
                exc,
            )
    return sent_total


async def _send_for_org(
    db: AsyncSession, org_id: str, reminders: List[OwedReminder]
) -> int:
    organization = (
        await db.execute(
            select(Organization).where(
                Organization.id == org_id, Organization.active.isnot(False)
            )
        )
    ).scalar_one_or_none()
    if organization is None:
        return 0
    today = reminders[0].today
    days_by_item = {r.item_id: r.days_until for r in reminders}

    rows = (
        await db.execute(
            select(MeetingActionItem, Meeting.title)
            .join(Meeting, Meeting.id == MeetingActionItem.meeting_id)
            .where(
                MeetingActionItem.id.in_(list(days_by_item)),
                MeetingActionItem.organization_id == org_id,
                MeetingActionItem.status.in_(OPEN_STATUSES),
                MeetingActionItem.assigned_to.isnot(None),
                or_(
                    MeetingActionItem.reminder_emailed_on.is_(None),
                    MeetingActionItem.reminder_emailed_on < today,
                ),
            )
        )
    ).all()
    by_assignee: Dict[str, List[Tuple[MeetingActionItem, str]]] = defaultdict(list)
    for item, meeting_title in rows:
        by_assignee[str(item.assigned_to)].append((item, meeting_title))
    if not by_assignee:
        return 0

    members = (
        (
            await db.execute(
                select(User).where(
                    User.id.in_(list(by_assignee)),
                    User.organization_id == org_id,
                    User.is_active,
                    User.email.isnot(None),
                )
            )
        )
        .scalars()
        .all()
    )
    recipients = recipients_for(
        members,
        EmailKind.MINUTES_ACTION_ITEMS,
        department_required_kinds(organization),
    )

    sent = 0
    for member in recipients:
        items = by_assignee[str(member.id)]
        if await _email(db, organization, member, items, days_by_item):
            for item, _title in items:
                item.reminder_emailed_on = today
            await db.commit()
            sent += 1
    return sent


async def _email(
    db: AsyncSession,
    organization: Organization,
    member: User,
    items: List[Tuple[MeetingActionItem, str]],
    days_by_item: Dict[str, int],
) -> bool:
    ordered = sorted(items, key=lambda pair: days_by_item[str(pair[0].id)])

    def when(item: MeetingActionItem) -> str:
        due = (
            f" ({item.due_date.strftime('%b %d, %Y')})"
            if item.due_date is not None
            else ""
        )
        return f"{urgency(days_by_item[str(item.id)])}{due}"

    lines = "".join(
        f"<li>{html.escape(item.description)} — {html.escape(when(item))}"
        f"<br><small>{html.escape(meeting_title or '')}</small></li>"
        for item, meeting_title in ordered
    )
    text = "\n".join(
        f"- {item.description} — {when(item)}"
        + (f"\n  {meeting_title}" if meeting_title else "")
        for item, meeting_title in ordered
    )
    link = f"{app_settings.FRONTEND_URL.rstrip('/')}/action-items"

    first = ordered[0][0]
    if len(ordered) == 1:
        subject = f"Action item {urgency(days_by_item[str(first.id)])}"
    else:
        overdue = sum(1 for item, _ in ordered if days_by_item[str(item.id)] < 0)
        subject = f"{len(ordered)} action items need attention" + (
            f", {overdue} overdue" if overdue else ""
        )
    try:
        email_service = EmailService(organization)
        rendered = await email_service.render_notice(
            EmailTemplateType.MEETING_ACTION_ITEM_REMINDER,
            {
                "reminder_summary": subject,
                "action_items_html": f"<ul>{lines}</ul>",
                "action_items_text": text,
                "action_items_url": link,
            },
            db,
        )
        if rendered is None:
            return False
        rendered_subject, html_body, text_body = rendered
        sent, _failed = await email_service.send_email(
            to_emails=[member.email],
            subject=rendered_subject,
            html_body=html_body,
            text_body=text_body,
            db=db,
            template_type=EmailTemplateType.MEETING_ACTION_ITEM_REMINDER.value,
        )
        return bool(sent)
    except Exception as exc:
        logger.warning(
            "Meeting action item reminder to member {} failed: {}", member.id, exc
        )
        return False
