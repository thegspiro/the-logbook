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
from app.models.minute import ActionItem, MeetingMinutes, MinutesMeetingType
from app.models.user import Organization, User
from app.services.email_policy import (
    EmailKind,
    department_required_kinds,
    recipients_for,
)
from app.services.email_service import EmailService, wrap_email_body
from app.services.email_theme import ACCENT_INDIGO, action
from app.utils.org_timezone import scheduling_timezone


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

    tz = scheduling_timezone(organization)
    link = f"{settings.FRONTEND_URL.rstrip('/')}/minutes/{minutes.id}"
    sent_total = 0
    for member in recipients:
        rows = []
        for item in by_assignee[str(member.id)]:
            due = (
                f" — due {item.due_date.astimezone(tz).strftime('%b %d, %Y')}"
                if item.due_date is not None and item.due_date.tzinfo
                else (
                    f" — due {item.due_date.strftime('%b %d, %Y')}"
                    if item.due_date is not None
                    else ""
                )
            )
            rows.append(f"<li>{html.escape(item.description)}{html.escape(due)}</li>")
        body = (
            f"<p>You were assigned work at <strong>{html.escape(minutes.title)}"
            "</strong>.</p>"
            f"<ul>{''.join(rows)}</ul>" + action(html.escape(link), "View the minutes")
        )
        try:
            sent, _failed = await EmailService().send_email(
                to_emails=[member.email],
                subject=f"Action items assigned to you — {minutes.title}",
                html_body=wrap_email_body(
                    organization,
                    "Action items assigned to you",
                    body,
                    header_color=ACCENT_INDIGO,
                    chip="Meeting minutes",
                ),
                db=db,
                template_type="minutes_action_items",
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

    link = f"{settings.FRONTEND_URL.rstrip('/')}/minutes/{minutes.id}"
    body = (
        f"<p>The minutes of <strong>{html.escape(minutes.title)}</strong> are "
        "ready for your review.</p>"
        "<p>Read them in Minutes and use <em>Suggest a change</em> if "
        "something is wrong or missing. The secretary will work in what is "
        "accepted before the minutes are adopted.</p>"
        + action(html.escape(link), "Review the minutes")
    )
    html_body = wrap_email_body(
        organization,
        "Minutes ready for review",
        body,
        header_color=ACCENT_INDIGO,
        chip="Meeting minutes",
    )
    sent_total = 0
    for member in recipients:
        try:
            sent, _failed = await EmailService().send_email(
                to_emails=[member.email],
                subject=f"Minutes for review — {minutes.title}",
                html_body=html_body,
                db=db,
                template_type="minutes_circulated",
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
