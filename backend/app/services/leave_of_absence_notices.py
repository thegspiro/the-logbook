"""Tell a member an officer recorded, changed or removed their leave of absence.

A leave reduces the member's training requirements, so it changes their
standing as much as an edit to a training record does. Until this notice the
member learned of it only by opening My Training.

The email goes under ``EmailKind.TRAINING_RECORD_CHANGES``, which is required:
it changes the member's official training record (CLAUDE.md pitfall #18 —
email is the channel of record). Never SMS, and no bell entry. An officer
acting on their own leave is not told about it, as with training records.

**The leave's reason and type never leave the database through this path.**
See ``email_templates_leave`` for why.

**Safe to run twice (pitfall #36).** The endpoint decides what kind of notice
a request is from the leave before and after it, so a repeated PATCH that
changes nothing, or a second DELETE of a leave already removed, sends nothing.
"""

from datetime import date
from typing import Any, Dict, Mapping, Optional

from loguru import logger
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.compliance_config import LeaveMonthRule
from app.models.user import MemberLeaveOfAbsence, Organization, User
from app.services.email_policy import (
    EmailKind,
    department_required_kinds,
    member_receives_email,
)
from app.services.training_waiver_service import get_leave_month_rule

RECORDED = "recorded"
UPDATED = "updated"
REMOVED = "removed"

MY_TRAINING_PATH = "/training/my-training"

# The fields whose change the member is told about. The reason is the member's
# own words, so a change to it is not news; who granted it is not either.
NOTICE_FIELDS = (
    "leave_type",
    "start_date",
    "end_date",
    "exempt_from_training_waiver",
    "active",
)

# The department's leave month rule, as the member reads it. The frontend's
# LEAVE_MONTH_RULE_SUMMARY says the same on My Training.
RULE_SENTENCES: Mapping[str, str] = {
    LeaveMonthRule.FULL_MONTH.value: "Any day of leave excuses the whole month.",
    LeaveMonthRule.PROPORTIONAL.value: (
        "A partly covered month is excused by the share of its days on leave."
    ),
    LeaveMonthRule.HALF.value: (
        "15 or more days of leave excuses half the month; a whole month "
        "excuses all of it."
    ),
}


def snapshot(leave: MemberLeaveOfAbsence) -> Dict[str, Any]:
    """The values of *leave* a notice is decided on, to compare after an edit."""
    return {
        field: getattr(getattr(leave, field), "value", getattr(leave, field))
        for field in NOTICE_FIELDS
    }


def notice_kind(
    before: Optional[Mapping[str, Any]], after: Mapping[str, Any]
) -> Optional[str]:
    """Which notice a change from *before* to *after* calls for, if any.

    ``before`` is ``None`` for a leave just created. A leave that was and
    stays inactive is not on the member's record, so editing it says nothing.
    """
    if before is None:
        return RECORDED if after.get("active") else None
    was_active, is_active = bool(before.get("active")), bool(after.get("active"))
    if was_active and not is_active:
        return REMOVED
    if not was_active:
        return RECORDED if is_active else None
    if any(before.get(f) != after.get(f) for f in NOTICE_FIELDS):
        return UPDATED
    return None


def _date(value: Optional[date]) -> str:
    # The format every other email date uses.
    return value.strftime("%B %d, %Y") if value else "No end date"


def training_effect(kind: str, exempt: bool, rule: str) -> str:
    """What the leave does to the member's training requirements."""
    if kind == REMOVED:
        if exempt:
            return (
                "This leave did not reduce your training requirements, so "
                "they are unchanged."
            )
        return (
            "This leave no longer reduces your training requirements: they "
            "apply in full for the months it covered."
        )
    if exempt:
        return (
            "Your training requirements stay in force during this leave, so "
            "it does not reduce them."
        )
    rule_sentence = RULE_SENTENCES.get(
        rule, RULE_SENTENCES[LeaveMonthRule.FULL_MONTH.value]
    )
    return (
        "While you are on leave, your training requirements are reduced for "
        f"the months it covers. {rule_sentence} Training you complete during "
        "the leave still counts."
    )


def build_context(
    leave: MemberLeaveOfAbsence,
    kind: str,
    officer_name: str,
    member_name: str,
    rule: str,
) -> Dict[str, str]:
    """The template variables. Never the leave's reason or type."""
    action = {
        RECORDED: "recorded a leave of absence for you",
        UPDATED: "updated your leave of absence",
        REMOVED: "removed your leave of absence",
    }
    if kind not in action:
        raise ValueError(f"Unknown leave notice: {kind}")
    return {
        "member_name": member_name,
        "change_word": kind,
        "summary": f"{officer_name} {action[kind]}.",
        "start_date": _date(leave.start_date),
        "end_date": _date(leave.end_date),
        "training_effect": training_effect(
            kind, bool(leave.exempt_from_training_waiver), rule
        ),
        "training_url": f"{settings.FRONTEND_URL.rstrip('/')}{MY_TRAINING_PATH}",
    }


def _display_name(user: Optional[User], fallback: str) -> str:
    if user is None:
        return fallback
    return user.display_name or user.username or fallback


async def send_leave_notice(
    organization_id: str, leave_id: str, officer_id: str, kind: str
) -> None:
    """Background task: tell the leave's member what an officer did to it.

    Runs on its own session after the response has gone, so nothing here can
    fail or slow the officer's action; it never raises. The leave is re-read
    so the notice reflects what was committed.
    """
    from app.core.database import database_manager

    try:
        async for session in database_manager.get_session():
            await deliver_leave_notice(
                session, str(organization_id), str(leave_id), str(officer_id), kind
            )
    except Exception as exc:  # pragma: no cover - defensive
        logger.warning("Leave of absence notice failed: {}", exc)


async def deliver_leave_notice(
    session: AsyncSession,
    organization_id: str,
    leave_id: str,
    officer_id: str,
    kind: str,
) -> bool:
    """Send the email. Returns whether one went out (``False`` for an
    officer's own leave, a departed member, a member with no address, or one
    whose preferences the department lets switch it off)."""
    leave = (
        await session.execute(
            select(MemberLeaveOfAbsence).where(
                MemberLeaveOfAbsence.id == leave_id,
                MemberLeaveOfAbsence.organization_id == organization_id,
            )
        )
    ).scalar_one_or_none()
    if leave is None or str(leave.user_id) == str(officer_id):
        return False
    member = (
        await session.execute(
            select(User).where(
                User.id == str(leave.user_id),
                User.organization_id == organization_id,
                User.is_active,
            )
        )
    ).scalar_one_or_none()
    if member is None or not member.email:
        return False
    org = await session.get(Organization, organization_id)
    if not member_receives_email(
        member.notification_preferences,
        EmailKind.TRAINING_RECORD_CHANGES,
        department_required_kinds(org),
    ):
        return False
    officer = (
        await session.execute(
            select(User).where(
                User.id == str(officer_id), User.organization_id == organization_id
            )
        )
    ).scalar_one_or_none()
    context = build_context(
        leave,
        kind,
        _display_name(officer, "A department officer"),
        _display_name(member, ""),
        await get_leave_month_rule(session, organization_id),
    )
    try:
        from app.services.email_service import EmailService

        return await EmailService(organization=org).send_leave_of_absence_notice_email(
            to_email=member.email,
            context=context,
            db=session,
            organization_id=organization_id,
        )
    except Exception as exc:
        logger.warning("Leave of absence notice email failed: {}", exc)
        return False
