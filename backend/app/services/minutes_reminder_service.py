"""Reminder emails for open action items from adopted meeting minutes.

Two emails, both run daily by the ``minutes_action_item_reminders`` task:

* **To the assignee**, one email per member per run listing their items that
  are due soon or overdue. The first reminder goes out a department-chosen
  number of days before the due date, the first overdue one the day after it,
  and further overdue ones every few days until the item is completed or
  cancelled.
* **To the people who manage minutes**, a weekly list of every open item and
  who owns it, so work nobody was assigned or nobody finished does not sit
  unnoticed.

Email is the channel of record (CLAUDE.md pitfall #18); the bell reminders of
``run_action_item_reminders`` are an addition to it, not a substitute. The
department's settings are read through ``app.utils.minutes_settings`` (pitfall
#19). Only items on adopted minutes are reminded about: a draft's items are not
yet a commitment and can still change, the same rule ``notify_action_item_
assignees`` follows.

A failed send is logged and the item is left unmarked, so the next run tries
again; one bad address never stops the rest of the department's reminders.
"""

import copy
import html
from collections import defaultdict
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta, timezone
from typing import Dict, List, Optional

from loguru import logger
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.config import settings as app_settings
from app.core.permissions import permission_matches
from app.models.minute import (
    ActionItem,
    MeetingMinutes,
    MinutesActionItemStatus,
    MinutesStatus,
)
from app.models.user import Organization, User
from app.services.email_policy import (
    EmailKind,
    department_required_kinds,
    member_receives_email,
    recipients_for,
)
from app.services.email_service import EmailService, wrap_email_body
from app.services.email_theme import ACCENT_INDIGO, action
from app.utils.minutes_settings import (
    LAST_DIGEST_KEY,
    MINUTES_SETTINGS_KEY,
    MinutesReminderSettings,
    load_minutes_reminder_settings,
)
from app.utils.org_timezone import (
    org_today,
    scheduling_timezone,
    stored_calendar_day,
)

# An item this far past due is no longer chased by email. A backlog of old open
# items would otherwise mail a member about work from years ago the first time
# the task runs; the weekly list still shows them.
MAX_OVERDUE_DAYS_REMINDED = 90

DIGEST_MIN_GAP_DAYS = 7
DIGEST_ROWS_SHOWN = 50

OPEN_STATUSES = (
    MinutesActionItemStatus.PENDING.value,
    MinutesActionItemStatus.IN_PROGRESS.value,
    MinutesActionItemStatus.OVERDUE.value,
)

DUE_SOON = "due_soon"
OVERDUE = "overdue"

_CELL = "padding:6px 12px;border-bottom:1px solid #eee;"


def due_day(item: ActionItem) -> Optional[date]:
    """The calendar day an item is due, or None (see ``stored_calendar_day``)."""
    return stored_calendar_day(item.due_date)


def classify(
    due: date,
    today: date,
    last_reminded_on: Optional[date],
    reminder_settings: MinutesReminderSettings,
) -> Optional[str]:
    """Whether an item is owed a reminder today: ``due_soon``, ``overdue`` or None.

    ``last_reminded_on`` is the department-local day of the last reminder.
    """
    days_until = (due - today).days
    if days_until >= 0:
        if days_until > reminder_settings.days_before_due:
            return None
        window_opened = due - timedelta(days=reminder_settings.days_before_due)
        if last_reminded_on is None or last_reminded_on < window_opened:
            return DUE_SOON
        return None

    if -days_until > MAX_OVERDUE_DAYS_REMINDED:
        return None
    # Not yet told it is overdue: the last reminder, if any, was on or before
    # the due date.
    if last_reminded_on is None or last_reminded_on <= due:
        return OVERDUE
    repeat = reminder_settings.overdue_repeat_days
    if repeat > 0 and (today - last_reminded_on).days >= repeat:
        return OVERDUE
    return None


@dataclass
class _Reminder:
    item: ActionItem
    kind: str
    due: date


class MinutesReminderService:
    def __init__(self, db: AsyncSession):
        self.db = db

    # ── Assignee reminders ──────────────────────────────────────────────

    async def send_assignee_reminders(self, organization: Organization) -> int:
        """Email each assignee their due-soon and overdue items; returns emails sent."""
        org_id = str(organization.id)
        reminder_settings = await load_minutes_reminder_settings(self.db, org_id)
        if not reminder_settings.reminders_enabled:
            return 0

        today = org_today(organization)
        tz = scheduling_timezone(organization)
        now = datetime.now(timezone.utc)

        earliest = datetime.combine(
            today - timedelta(days=MAX_OVERDUE_DAYS_REMINDED),
            time.min,
            tzinfo=timezone.utc,
        )
        latest = datetime.combine(
            today + timedelta(days=reminder_settings.days_before_due),
            time.min,
            tzinfo=timezone.utc,
        )
        items = (
            (
                await self.db.execute(
                    select(ActionItem)
                    .options(selectinload(ActionItem.minutes))
                    .join(MeetingMinutes, MeetingMinutes.id == ActionItem.minutes_id)
                    .where(
                        MeetingMinutes.organization_id == org_id,
                        MeetingMinutes.status == MinutesStatus.APPROVED.value,
                        ActionItem.status.in_(OPEN_STATUSES),
                        ActionItem.assignee_id.isnot(None),
                        ActionItem.carried_forward_at.is_(None),
                        ActionItem.due_date.isnot(None),
                        ActionItem.due_date >= earliest,
                        ActionItem.due_date <= latest,
                    )
                )
            )
            .scalars()
            .all()
        )

        by_assignee: Dict[str, List[_Reminder]] = defaultdict(list)
        for item in items:
            due = due_day(item)
            if due is None:
                continue
            last = item.last_reminded_at
            last_day = None
            if last is not None:
                if last.tzinfo is None:
                    last = last.replace(tzinfo=timezone.utc)
                last_day = last.astimezone(tz).date()
            kind = classify(due, today, last_day, reminder_settings)
            if kind is not None:
                by_assignee[str(item.assignee_id)].append(_Reminder(item, kind, due))
        if not by_assignee:
            return 0

        members = (
            (
                await self.db.execute(
                    select(User).where(
                        User.id.in_(list(by_assignee)),
                        User.organization_id == org_id,
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

        sent_total = 0
        for member in recipients:
            reminders = by_assignee[str(member.id)]
            if await self._email_assignee(organization, member, reminders):
                for reminder in reminders:
                    reminder.item.last_reminded_at = now
                await self.db.commit()
                sent_total += 1
        return sent_total

    async def _email_assignee(
        self, organization: Organization, member: User, reminders: List[_Reminder]
    ) -> bool:
        overdue = sorted(
            (r for r in reminders if r.kind == OVERDUE), key=lambda r: r.due
        )
        soon = sorted((r for r in reminders if r.kind == DUE_SOON), key=lambda r: r.due)

        def rows(group: List[_Reminder]) -> str:
            return (
                "<ul>"
                + "".join(
                    f"<li>{html.escape(r.item.description)} — due "
                    f"{r.due.strftime('%b %d, %Y')} "
                    f"({html.escape(r.item.minutes.title)})</li>"
                    for r in group
                )
                + "</ul>"
            )

        body = ""
        if overdue:
            body += f"<p><strong>Overdue ({len(overdue)})</strong></p>{rows(overdue)}"
        if soon:
            body += f"<p><strong>Due soon ({len(soon)})</strong></p>{rows(soon)}"
        link = f"{app_settings.FRONTEND_URL.rstrip('/')}/action-items"
        body += action(html.escape(link), "View your action items")

        if overdue:
            subject = f"{len(overdue)} overdue action item(s)" + (
                f" and {len(soon)} due soon" if soon else ""
            )
        else:
            subject = f"{len(soon)} action item(s) due soon"
        try:
            sent, _failed = await EmailService().send_email(
                to_emails=[member.email],
                subject=subject,
                html_body=wrap_email_body(
                    organization,
                    "Action item reminder",
                    body,
                    header_color=ACCENT_INDIGO,
                    chip="Meeting minutes",
                ),
                db=self.db,
                template_type="minutes_action_item_reminder",
            )
            return bool(sent)
        except Exception as exc:
            logger.warning(
                "Action item reminder to member {} failed: {}", member.id, exc
            )
            return False

    # ── Weekly list for the people who manage minutes ───────────────────

    async def send_open_items_digest(self, organization: Organization) -> int:
        """Email the open-items list to minutes managers, at most weekly."""
        org_id = str(organization.id)
        reminder_settings = await load_minutes_reminder_settings(self.db, org_id)
        if not reminder_settings.digest_enabled:
            return 0

        today = org_today(organization)
        stored = (
            (organization.settings or {}).get(MINUTES_SETTINGS_KEY)
            if isinstance(organization.settings, dict)
            else None
        )
        last_sent = self._last_digest_day(stored)
        if last_sent is not None and (today - last_sent).days < DIGEST_MIN_GAP_DAYS:
            return 0

        items = (
            (
                await self.db.execute(
                    select(ActionItem)
                    .options(selectinload(ActionItem.minutes))
                    .join(MeetingMinutes, MeetingMinutes.id == ActionItem.minutes_id)
                    .where(
                        MeetingMinutes.organization_id == org_id,
                        MeetingMinutes.status == MinutesStatus.APPROVED.value,
                        ActionItem.status.in_(OPEN_STATUSES),
                        ActionItem.carried_forward_at.is_(None),
                    )
                )
            )
            .scalars()
            .all()
        )
        if not items:
            return 0

        recipients = await self._minutes_managers(organization)
        if not recipients:
            return 0

        far = date.max

        def order(item: ActionItem):
            due = due_day(item)
            return (due is None, due or far, item.description)

        overdue = [i for i in items if (d := due_day(i)) is not None and d < today]
        overdue.sort(key=order)
        overdue_ids = {i.id for i in overdue}
        rest = sorted((i for i in items if i.id not in overdue_ids), key=order)
        shown = (overdue + rest)[:DIGEST_ROWS_SHOWN]
        more = len(items) - len(shown)

        table_rows = ""
        for item in shown:
            due = due_day(item)
            late = due is not None and due < today
            owner = item.assignee_name or "Unassigned"
            table_rows += (
                f"<tr><td style='{_CELL}'>{html.escape(item.description)}</td>"
                f"<td style='{_CELL}'>{html.escape(owner)}</td>"
                f"<td style='{_CELL}'>"
                + (
                    f"{due.strftime('%b %d, %Y')}{' (overdue)' if late else ''}"
                    if due
                    else "No due date"
                )
                + "</td></tr>"
            )
        link = f"{app_settings.FRONTEND_URL.rstrip('/')}/action-items"
        body = (
            f"<p>{len(items)} action item(s) from adopted minutes are still open"
            + (f", {len(overdue)} of them overdue" if overdue else "")
            + ".</p>"
            '<table style="width:100%;border-collapse:collapse;margin:16px 0;">'
            '<thead><tr style="background:#f3f4f6;">'
            '<th style="padding:8px 12px;text-align:left;">Item</th>'
            '<th style="padding:8px 12px;text-align:left;">Owner</th>'
            '<th style="padding:8px 12px;text-align:left;">Due</th>'
            f"</tr></thead><tbody>{table_rows}</tbody></table>"
            + (f"<p>…and {more} more.</p>" if more > 0 else "")
            + action(html.escape(link), "Open the action items")
        )
        html_body = wrap_email_body(
            organization,
            "Open action items",
            body,
            header_color=ACCENT_INDIGO,
            chip="Meeting minutes",
        )

        sent_total = 0
        for member in recipients:
            try:
                sent, _failed = await EmailService().send_email(
                    to_emails=[member.email],
                    subject=f"Open action items — {len(items)} to follow up",
                    html_body=html_body,
                    db=self.db,
                    template_type="minutes_open_items_digest",
                )
                sent_total += sent
            except Exception as exc:
                logger.warning(
                    "Open action items digest to member {} failed: {}", member.id, exc
                )
        if sent_total:
            self._record_digest(organization, today)
            await self.db.commit()
        return sent_total

    @staticmethod
    def _last_digest_day(section) -> Optional[date]:
        raw = section.get(LAST_DIGEST_KEY) if isinstance(section, dict) else None
        if not isinstance(raw, str):
            return None
        try:
            return date.fromisoformat(raw)
        except ValueError:
            return None

    @staticmethod
    def _record_digest(organization: Organization, today: date) -> None:
        # A deep copy reassigned whole: a nested mutation of a JSON column is
        # not seen by SQLAlchemy (CLAUDE.md pitfall #12).
        current = copy.deepcopy(organization.settings or {})
        section = current.get(MINUTES_SETTINGS_KEY)
        if not isinstance(section, dict):
            section = {}
        section[LAST_DIGEST_KEY] = today.isoformat()
        current[MINUTES_SETTINGS_KEY] = section
        organization.settings = current

    async def _minutes_managers(self, organization: Organization) -> List[User]:
        """Active members holding ``minutes.manage`` who have not opted out."""
        required = department_required_kinds(organization)
        users = (
            (
                await self.db.execute(
                    select(User)
                    .where(
                        User.organization_id == str(organization.id),
                        User.is_active,
                        User.email.isnot(None),
                    )
                    .options(selectinload(User.roles))
                )
            )
            .scalars()
            .all()
        )
        recipients: List[User] = []
        for user in users:
            granted: set[str] = set()
            for role in user.roles or []:
                granted.update(role.permissions or [])
            if permission_matches("minutes.manage", granted) and member_receives_email(
                user.notification_preferences, EmailKind.MINUTES_DUTIES, required
            ):
                recipients.append(user)
        return recipients
