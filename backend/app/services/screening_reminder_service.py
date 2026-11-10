"""Medical screening expiry reminders (W71b-4, owner decision 2026-11-06).

The member is emailed before a screening falls due, on the certification
reminders' tiers: 90, 60, 30 and 7 days out. As with certifications, only the
most urgent tier a screening has reached is sent, and the tiers it skipped are
marked spent, so a screening recorded 20 days before its due date gets the
30-day reminder once rather than three reminders on one morning.

What decides who is reminded, and what each piece reuses:

* **Which screenings, and when they are due** — the Compliance tab's own
  expiring list (``MedicalScreeningService.get_reminder_candidates``), so a
  reminder and the screen it points to agree (pitfall #29), including a due
  date derived from the requirement's frequency.
* **Whether the department has them** — the Medical Screening module must be
  on, and the ``medical_screening_expiry`` notification rule must not be
  switched off. With no rule they are on: the owner decided screenings get
  reminders, so absence means the decided behaviour, the same reading
  ``NotificationRuleResolver`` gives every trigger (pitfall #19).
* **Whether the member gets the email** — ``EmailKind.TRAINING_REMINDERS``,
  the choice certification reminders honour ("Training and certification
  reminders"), so a member who muted those is not emailed about screenings.

Email only (pitfall #18): no text, and no bell entry either. A bell entry is
stored in ``notification_logs`` in plaintext, and naming a member's screening
there would put back at rest what MS-18 encrypted. The email itself names the
requirement and the due date and nothing else — no result, status or notes —
and its subject names neither, since subjects reach mail previews and logs.

Run twice, it sends once (pitfall #36). The key is
``(screening_record_id, tier_days, due_date)``, unique on
``screening_reminder_sends``. A run inserts that row, sends, and commits, one
screening at a time. A second run finds the row and skips; two runs at once
collide on the unique index, and the one that loses skips. A crash between the
send and the commit rolls the row back and the reminder goes again the next
day: at least once, which is right for a reminder, where a duplicate is a
nuisance and a missed one is a lapsed screening.
"""

import html
from dataclasses import dataclass
from datetime import date
from typing import Dict, List, Optional, Set, Tuple
from uuid import UUID

from loguru import logger
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.medical_screening import ScreeningReminderSend
from app.models.notification import NotificationTrigger
from app.models.user import ACTIVE_ACCOUNT_STATUSES, Organization, User
from app.services.email_policy import (
    EmailKind,
    department_required_kinds,
    member_receives_email,
)
from app.services.email_service import EmailService, wrap_email_body
from app.services.medical_screening_service import MedicalScreeningService
from app.services.notification_rules import NotificationRuleResolver
from app.services.organization_service import OrganizationService
from app.utils.org_timezone import org_today

#: Days before the due date at which a reminder goes out, as for certifications.
REMINDER_TIERS: Tuple[int, ...] = (90, 60, 30, 7)

SUBJECT = "A medical screening is due soon"


@dataclass(frozen=True)
class _Due:
    """What one reminder needs, copied off the rows before the loop.

    Each reminder commits or rolls back on its own, and a rollback expires
    every loaded row; reading a column off one afterwards would lazy-load
    outside the async context.
    """

    record_id: str
    requirement_name: str
    due: date
    member_email: Optional[str]
    member_name: str
    receives_email: bool


def _due_when(days_until: int) -> str:
    if days_until <= 0:
        return "today"
    if days_until == 1:
        return "tomorrow"
    return f"in {days_until} days"


def _tiers_reached(days_until: int) -> List[int]:
    return [tier for tier in REMINDER_TIERS if days_until <= tier]


class ScreeningReminderService:
    """Sends one organization's screening expiry reminders."""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def _enabled(self, organization_id: str) -> bool:
        modules = await OrganizationService(self.db).get_enabled_modules(
            organization_id
        )
        if "medical_screening" not in modules.enabled_modules:
            return False
        return await NotificationRuleResolver(self.db).is_enabled(
            organization_id, NotificationTrigger.MEDICAL_SCREENING_EXPIRY
        )

    async def _sent_keys(
        self, organization_id: str, record_ids: List[str]
    ) -> Set[Tuple[str, int, date]]:
        if not record_ids:
            return set()
        rows = await self.db.execute(
            select(
                ScreeningReminderSend.screening_record_id,
                ScreeningReminderSend.tier_days,
                ScreeningReminderSend.due_date,
            ).where(
                ScreeningReminderSend.organization_id == organization_id,
                ScreeningReminderSend.screening_record_id.in_(record_ids),
            )
        )
        return {(str(rid), int(tier), due) for rid, tier, due in rows.all()}

    async def _current_members(
        self, organization_id: str, user_ids: Set[str]
    ) -> Dict[str, User]:
        if not user_ids:
            return {}
        rows = await self.db.execute(
            select(User).where(
                User.organization_id == organization_id,
                User.id.in_(user_ids),
                User.status.in_(ACTIVE_ACCOUNT_STATUSES),
                User.deleted_at.is_(None),
            )
        )
        return {str(user.id): user for user in rows.scalars().all()}

    async def _claim(
        self, organization_id: str, record_id: str, tiers: List[int], due: date
    ) -> bool:
        """Insert the send rows for ``tiers``; False if another run has them."""
        try:
            async with self.db.begin_nested():
                for tier in tiers:
                    self.db.add(
                        ScreeningReminderSend(
                            organization_id=organization_id,
                            screening_record_id=record_id,
                            tier_days=tier,
                            due_date=due,
                        )
                    )
                await self.db.flush()
        except IntegrityError:
            return False
        return True

    async def _release(self, org: Organization) -> None:
        """Roll back one reminder's claim, keeping ``org`` usable.

        The rollback expires every loaded row, the organization the email is
        built from included.
        """
        await self.db.rollback()
        await self.db.refresh(org)

    def _email(self, org: Organization, item: _Due, days_until: int) -> Tuple[str, str]:
        when = _due_when(days_until)
        due_text = item.due.strftime("%B %d, %Y")
        link = f"{settings.FRONTEND_URL}/dashboard"
        name = item.member_name
        greeting = f"Hi {name}," if name else "Hello,"
        html_body = wrap_email_body(
            org,
            "Medical screening due",
            f"<p>{html.escape(greeting)}</p>"
            f"<p>Your <strong>{html.escape(item.requirement_name)}</strong> is "
            f"due on <strong>{due_text}</strong> ({when}). Please arrange it "
            "before then so you stay compliant.</p>"
            "<p>Your department's medical officer can tell you how.</p>"
            f'<p><a href="{html.escape(link)}">Open The Logbook</a></p>',
            chip="Due soon",
        )
        text_body = (
            f"{greeting}\n\n"
            f"Your {item.requirement_name} is due on {due_text} ({when}). "
            "Please arrange it before then so you stay compliant.\n\n"
            "Your department's medical officer can tell you how.\n\n"
            f"{link}\n"
        )
        return html_body, text_body

    async def process_reminders(self, organization_id: UUID | str) -> Dict[str, int]:
        """Send this organization's due reminders.

        Returns ``{"reminders_sent", "skipped_opted_out", "errors"}``.
        """
        org_id = str(organization_id)
        counts = {"reminders_sent": 0, "skipped_opted_out": 0, "errors": 0}
        org: Optional[Organization] = await self.db.get(Organization, org_id)
        if org is None or not await self._enabled(org_id):
            return counts

        today = org_today(org)
        candidates = await MedicalScreeningService(self.db).get_reminder_candidates(
            org_id, today, max(REMINDER_TIERS)
        )
        if not candidates:
            return counts
        sent = await self._sent_keys(org_id, [str(r.id) for r, _, _ in candidates])
        members = await self._current_members(
            org_id, {str(r.user_id) for r, _, _ in candidates if r.user_id}
        )
        department_required = department_required_kinds(org)
        items: List[_Due] = []
        for record, requirement, deadline in candidates:
            member = members.get(str(record.user_id))
            if deadline.due is None or member is None:
                continue
            items.append(
                _Due(
                    record_id=str(record.id),
                    requirement_name=requirement.name,
                    due=deadline.due,
                    member_email=member.email,
                    member_name=member.preferred_name or member.first_name or "",
                    receives_email=member_receives_email(
                        getattr(member, "notification_preferences", None),
                        EmailKind.TRAINING_REMINDERS,
                        department_required,
                    ),
                )
            )
        email_service = EmailService(org)

        for item in items:
            days_until = (item.due - today).days
            reached = _tiers_reached(days_until)
            if not reached or (item.record_id, min(reached), item.due) in sent:
                continue
            unspent = [t for t in reached if (item.record_id, t, item.due) not in sent]
            if not await self._claim(org_id, item.record_id, unspent, item.due):
                continue
            try:
                if not item.member_email or not item.receives_email:
                    # Spent all the same: the member chose not to receive it.
                    counts["skipped_opted_out"] += 1
                    await self.db.commit()
                    continue
                html_body, text_body = self._email(org, item, days_until)
                # No db=: the message-history copy would keep the body, and
                # with it the member's screening, in plaintext.
                accepted, _failed = await email_service.send_email(
                    to_emails=[item.member_email],
                    subject=SUBJECT,
                    html_body=html_body,
                    text_body=text_body,
                )
                if accepted > 0:
                    await self.db.commit()
                    counts["reminders_sent"] += 1
                else:
                    # Not sent: release the claim so tomorrow's run tries again.
                    await self._release(org)
                    counts["errors"] += 1
            except Exception as exc:
                logger.error(
                    "Screening reminder failed for record {}: {}", item.record_id, exc
                )
                await self._release(org)
                counts["errors"] += 1

        logger.info(
            "Screening reminders | org={} sent={} opted_out={} errors={}",
            org_id,
            counts["reminders_sent"],
            counts["skipped_opted_out"],
            counts["errors"],
        )
        return counts
