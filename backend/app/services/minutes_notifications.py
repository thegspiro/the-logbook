"""Email about meeting minutes: circulation for review and assigned work.

``notify_minutes_circulated`` tells the department that minutes are ready to
read and comment on. ``notify_action_item_assignees`` is described below.

Email to the members an approved set of minutes assigns work to.

Email is the channel of record (CLAUDE.md pitfall #18), and an action item is
a commitment the member is held to, so each assignee is emailed once per set
of minutes, listing their items. Nothing is sent for draft minutes: their
items are not yet a commitment and can still change.

The member's own opt-out and the department's "make this required" switch are
decided by ``email_policy`` under ``EmailKind.MINUTES_ACTION_ITEMS``; a failed
send is logged and never fails the approval that triggered it.
"""

import html
from collections import defaultdict
from typing import Dict, Iterable, List

from loguru import logger
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.email_template import EmailTemplateType
from app.models.minute import ActionItem, MeetingMinutes, MinutesMeetingType
from app.models.user import Organization, User
from app.services.email_policy import (
    EmailKind,
    department_required_kinds,
    recipients_for,
)
from app.services.email_service import EmailService
from app.utils.org_timezone import stored_calendar_day


async def notify_action_item_assignees(
    db: AsyncSession, minutes: MeetingMinutes, items: Iterable[ActionItem]
) -> int:
    """Email each assignee their items from *minutes*; returns emails sent."""
    by_assignee: Dict[str, List[ActionItem]] = defaultdict(list)
    for item in items:
        if item.assignee_id:
            by_assignee[str(item.assignee_id)].append(item)
    if not by_assignee:
        return 0

    organization = (
        await db.execute(
            select(Organization).where(Organization.id == str(minutes.organization_id))
        )
    ).scalar_one_or_none()
    members = (
        (
            await db.execute(
                select(User).where(
                    User.id.in_(list(by_assignee)),
                    User.organization_id == str(minutes.organization_id),
                    User.is_active,
                )
            )
        )
        .scalars()
        .all()
    )
    recipients = recipients_for(
        [m for m in members if m.email],
        EmailKind.MINUTES_ACTION_ITEMS,
        department_required_kinds(organization),
    )

    link = f"{settings.FRONTEND_URL.rstrip('/')}/minutes/{minutes.id}"
    email_service = EmailService(organization)
    sent_total = 0
    for member in recipients:
        rows = []
        lines = []
        for item in by_assignee[str(member.id)]:
            # A due date is a calendar day, not an instant: shown as stored.
            due_on = stored_calendar_day(item.due_date)
            due = f" — due {due_on.strftime('%b %d, %Y')}" if due_on else ""
            rows.append(f"<li>{html.escape(item.description)}{html.escape(due)}</li>")
            lines.append(f"- {item.description}{due}")
        try:
            rendered = await email_service.render_notice(
                EmailTemplateType.MINUTES_ACTION_ITEMS,
                {
                    "minutes_title": minutes.title,
                    "action_items_html": f"<ul>{''.join(rows)}</ul>",
                    "action_items_text": "\n".join(lines),
                    "minutes_url": link,
                },
                db,
            )
            if rendered is None:
                return sent_total
            subject, html_body, text_body = rendered
            sent, _failed = await email_service.send_email(
                to_emails=[member.email],
                subject=subject,
                html_body=html_body,
                text_body=text_body,
                db=db,
                template_type=EmailTemplateType.MINUTES_ACTION_ITEMS.value,
            )
            sent_total += sent
        except Exception as exc:
            logger.warning(
                "Action item email to member {} for minutes {} failed: {}",
                member.id,
                minutes.id,
                exc,
            )
    return sent_total


async def notify_minutes_circulated(db: AsyncSession, minutes: MeetingMinutes) -> int:
    """Email the department that *minutes* are circulated for review.

    Sent to every active member with an address except the officer who
    circulated them, who needs no telling. Executive-session minutes are never
    announced: members cannot read them, so the email would point at a page
    that answers 404. Members may opt out under
    ``EmailKind.MINUTES_CIRCULATED``; the minutes remain visible in the app
    either way.
    """
    meeting_type = getattr(minutes.meeting_type, "value", minutes.meeting_type)
    if meeting_type == MinutesMeetingType.EXECUTIVE.value:
        return 0

    organization = (
        await db.execute(
            select(Organization).where(Organization.id == str(minutes.organization_id))
        )
    ).scalar_one_or_none()
    conditions = [
        User.organization_id == str(minutes.organization_id),
        User.is_active,
    ]
    if minutes.submitted_by:
        conditions.append(User.id != str(minutes.submitted_by))
    members = (await db.execute(select(User).where(*conditions))).scalars().all()
    recipients = recipients_for(
        [m for m in members if m.email],
        EmailKind.MINUTES_CIRCULATED,
        department_required_kinds(organization),
    )

    if not recipients:
        return 0
    link = f"{settings.FRONTEND_URL.rstrip('/')}/minutes/{minutes.id}"
    email_service = EmailService(organization)
    # One body for everyone: nothing in it is per member.
    rendered = await email_service.render_notice(
        EmailTemplateType.MINUTES_CIRCULATED,
        {"minutes_title": minutes.title, "minutes_url": link},
        db,
    )
    if rendered is None:
        return 0
    subject, html_body, text_body = rendered
    sent_total = 0
    for member in recipients:
        try:
            sent, _failed = await email_service.send_email(
                to_emails=[member.email],
                subject=subject,
                html_body=html_body,
                text_body=text_body,
                db=db,
                template_type=EmailTemplateType.MINUTES_CIRCULATED.value,
            )
            sent_total += sent
        except Exception as exc:
            logger.warning(
                "Circulation email to member {} for minutes {} failed: {}",
                member.id,
                minutes.id,
                exc,
            )
    return sent_total
