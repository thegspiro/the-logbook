"""
Email for attendance waiver requests (owner decisions 2026-11-10).

One notice per entry in a request's decision log, each an editable template
(``email_templates_attendance_waivers``):

- **Submitted** → *requested*, to everyone the request is routed to: the
  policy's approver-position holders, falling back to the Chief and then to
  training managers, never the requester (``AttendanceWaiverService.recipients``
  is the one definition).
- **Approved, denied, Chief override** → *decided*, to the member.
- **Withdrawn** → *withdrawn*, to the approvers the request email actually
  reached, since only they have something to stop doing.

Each goes to one recipient per message, after the caller's commit, and never
fails the request: the member's request stands whether or not mail went out,
and the in-app prompt reaches every approver either way. Email is the channel
of record and no text is sent (CLAUDE.md pitfall #18).

**Preferences.** An approver's email is ``EmailKind.TRAINING_DUTIES``, which an
officer may switch off; the decision is the member's
``EmailKind.TRAINING_RECORD_CHANGES``, always sent, because it changes how
their attendance is graded.

**Copies.** The template's default CC, CC positions and BCC each get a separate
message: no buttons, no category, no decider's note, and a sentence saying it
is a copy. Never a CC on the approver's own message.

**A second run is a no-op (pitfall #36).** Every send claims an
``AttendanceWaiverEmailSend`` row keyed by ``(action_id, recipient_key)``,
which is unique, before the email goes out; a retry, or a second worker,
finds the claim and sends nothing. A send that fails releases its claim, so a
retry can try it again. ``send_for_action`` takes only the log row's id, so
it can be re-run at any time.
"""

import html as _html
from dataclasses import dataclass
from datetime import date, datetime, timezone
from typing import Dict, List, Optional, Sequence

from loguru import logger
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.security import email_fingerprint
from app.core.utils import generate_uuid
from app.models.attendance_waiver import (
    AttendanceWaiverAction,
    AttendanceWaiverEmailSend,
    AttendanceWaiverRequest,
    AttendanceWaiverRequestAction,
    AttendanceWaiverWorkflow,
)
from app.models.email_template import EmailTemplateType
from app.models.user import Organization, User
from app.services.email_policy import (
    EmailKind,
    department_required_kinds,
    member_receives_email,
)
from app.services.email_service import EmailService
from app.services.email_template_service import EmailTemplateService

# The request's page, which the decision page renders. ``?action=`` only
# preselects the choice: opening the link decides nothing (see
# email_templates_attendance_waivers).
REQUEST_PATH = "/attendance-waivers/{id}"

# Shown in a copy where a value is left out on purpose.
NOT_IN_COPY = "Not included in this copy"

APPROVER_KIND = EmailKind.TRAINING_DUTIES
MEMBER_KIND = EmailKind.TRAINING_RECORD_CHANGES

_REQUESTED = "requested"
_DECIDED = "decided"
_WITHDRAWN = "withdrawn"

# Which template each notice uses, per workflow. Only training is sent today;
# the meeting workflow adds its row when it sends.
_TEMPLATES: Dict[AttendanceWaiverWorkflow, Dict[str, EmailTemplateType]] = {
    AttendanceWaiverWorkflow.TRAINING_SESSION: {
        _REQUESTED: EmailTemplateType.SESSION_WAIVER_REQUESTED,
        _DECIDED: EmailTemplateType.SESSION_WAIVER_DECIDED,
        _WITHDRAWN: EmailTemplateType.SESSION_WAIVER_WITHDRAWN,
    },
}

_NOTICE_FOR_ACTION = {
    AttendanceWaiverAction.SUBMITTED: _REQUESTED,
    AttendanceWaiverAction.APPROVED: _DECIDED,
    AttendanceWaiverAction.DENIED: _DECIDED,
    AttendanceWaiverAction.CHIEF_OVERRIDE: _DECIDED,
    AttendanceWaiverAction.WITHDRAWN: _WITHDRAWN,
}

_OUTCOMES = {
    AttendanceWaiverAction.APPROVED: ("Approved", "approved", "was approved"),
    AttendanceWaiverAction.DENIED: ("Denied", "denied", "was denied"),
    AttendanceWaiverAction.CHIEF_OVERRIDE: (
        "Approved on the Chief's override",
        "approved",
        "was approved by the Chief on review of a denial",
    ),
}


def user_key(user_id: str) -> str:
    return f"user:{user_id}"


def address_key(address: str) -> str:
    return f"addr:{email_fingerprint(address) or address.strip().casefold()}"


def request_url(request_id: str, action: Optional[str] = None) -> str:
    base = (getattr(settings, "FRONTEND_URL", "") or "").rstrip("/")
    url = f"{base}{REQUEST_PATH.format(id=request_id)}"
    return f"{url}?action={action}" if action else url


def review_buttons_html(request_id: str) -> str:
    """The Approve and Deny buttons, as markup safe to insert unescaped.

    Built from fixed text and the escaped URLs only. Colours are literal
    because this value is inserted after the template's colourway tokens are
    filled.
    """

    def button(url: str, label: str, colour: str) -> str:
        href = _html.escape(url, quote=True)
        return (
            '<table class="cta" role="presentation" cellpadding="0" '
            f'cellspacing="0"><tr><td class="cta-cell" bgcolor="{colour}" '
            f'style="background-color: {colour};"><a href="{href}" '
            f'class="cta-link" style="border: 1px solid {colour};">{label}</a>'
            "</td></tr></table>"
        )

    approve = request_url(request_id, "approve")
    deny = request_url(request_id, "deny")
    return (
        button(approve, "Approve", "#047857")
        + button(deny, "Deny", "#b91c1c")
        + '<p class="action-link">Each button opens the request in the Logbook, '
        "where you confirm your decision.</p>"
    )


def _day(value: date) -> str:
    # The format every other notice prints a date in (email_template_service
    # _DATE), which is also what a test send of these templates fills in.
    return value.strftime("%B %d, %Y")


@dataclass
class _Recipient:
    key: str
    email: str
    name: str
    is_copy: bool


class AttendanceWaiverEmails:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def send_for_action(self, organization_id: str, action_id: str) -> int:
        """Send every email the log row ``action_id`` calls for; the count sent.

        Safe to call again: a recipient already sent to (or being sent to) is
        skipped. Never raises.
        """
        try:
            return await self._send_for_action(str(organization_id), str(action_id))
        except Exception:
            logger.exception(
                "Failed to email about waiver request action {}", action_id
            )
            try:
                await self.db.rollback()
            except Exception:
                logger.exception(
                    "Failed to reset the session after action {}", action_id
                )
            return 0

    async def _send_for_action(self, org_id: str, action_id: str) -> int:
        action = (
            await self.db.execute(
                select(AttendanceWaiverRequestAction).where(
                    AttendanceWaiverRequestAction.id == action_id,
                    AttendanceWaiverRequestAction.organization_id == org_id,
                )
            )
        ).scalar_one_or_none()
        if action is None:
            return 0
        notice = _NOTICE_FOR_ACTION.get(action.action)
        request = (
            await self.db.execute(
                select(AttendanceWaiverRequest).where(
                    AttendanceWaiverRequest.id == action.request_id,
                    AttendanceWaiverRequest.organization_id == org_id,
                )
            )
        ).scalar_one_or_none()
        if notice is None or request is None:
            return 0
        template_type = _TEMPLATES.get(request.workflow, {}).get(notice)
        if template_type is None:
            return 0
        organization = await self.db.get(Organization, org_id)
        if organization is None:
            return 0

        primary = await self._primary(org_id, organization, request, action, notice)
        copies = await self._copies(org_id, template_type, primary)
        names = await self._names(org_id, [request.user_id, action.actor_id])
        member_name = names.get(str(request.user_id), "A member")

        service = EmailService(organization)
        sent = 0
        for recipient in primary + copies:
            context = self._context(
                notice, request, action, recipient, member_name, names
            )
            if await self._send_once(
                service, org_id, request, action, recipient, template_type, context
            ):
                sent += 1
        return sent

    # ------------------------------------------------------------------
    # Who is told
    # ------------------------------------------------------------------

    async def _primary(
        self,
        org_id: str,
        organization: Organization,
        request: AttendanceWaiverRequest,
        action: AttendanceWaiverRequestAction,
        notice: str,
    ) -> List[_Recipient]:
        if notice == _REQUESTED:
            from app.services.attendance_waiver_service import (
                AttendanceWaiverService,
            )

            # Routed by the request's own workflow's positions and fallbacks.
            waivers = AttendanceWaiverService(self.db, request.workflow)
            policy = await waivers.get_policy(org_id)
            users = await waivers.recipients(org_id, request, policy)
            kind = APPROVER_KIND
        elif notice == _DECIDED:
            users = await self._users(org_id, [str(request.user_id)])
            kind = MEMBER_KIND
        else:
            users = await self._users(org_id, await self._asked(org_id, request))
            kind = APPROVER_KIND
        required = department_required_kinds(organization)
        return [
            _Recipient(user_key(str(u.id)), u.email, u.display_name, False)
            for u in users
            if u.email
            and member_receives_email(u.notification_preferences, kind, required)
        ]

    async def _asked(self, org_id: str, request: AttendanceWaiverRequest) -> List[str]:
        """The approvers the request email reached."""
        rows = await self.db.execute(
            select(AttendanceWaiverEmailSend.recipient_key)
            .join(
                AttendanceWaiverRequestAction,
                AttendanceWaiverRequestAction.id == AttendanceWaiverEmailSend.action_id,
            )
            .where(
                AttendanceWaiverEmailSend.organization_id == org_id,
                AttendanceWaiverEmailSend.request_id == str(request.id),
                AttendanceWaiverEmailSend.is_copy.is_(False),
                AttendanceWaiverEmailSend.sent_at.is_not(None),
                AttendanceWaiverRequestAction.action
                == AttendanceWaiverAction.SUBMITTED,
            )
        )
        return [
            key.split(":", 1)[1] for (key,) in rows.all() if key.startswith("user:")
        ]

    async def _users(self, org_id: str, ids: Sequence[str]) -> List[User]:
        if not ids:
            return []
        rows = await self.db.execute(
            select(User)
            .where(User.id.in_(list(ids)), User.organization_id == org_id)
            .order_by(User.last_name, User.first_name)
        )
        return [u for u in rows.scalars().all() if u.is_active]

    async def _copies(
        self,
        org_id: str,
        template_type: EmailTemplateType,
        primary: List[_Recipient],
    ) -> List[_Recipient]:
        cc, bcc = await EmailTemplateService(self.db).stored_copy_recipients(
            org_id, template_type
        )
        taken = {r.email.strip().casefold() for r in primary}
        copies: List[_Recipient] = []
        for address in cc + bcc:
            folded = address.strip().casefold()
            if folded in taken:
                continue
            taken.add(folded)
            copies.append(_Recipient(address_key(address), address, "", True))
        return copies

    async def _names(self, org_id: str, ids: Sequence[Optional[str]]) -> Dict[str, str]:
        users = await self._users_any(org_id, [str(i) for i in ids if i])
        return {str(u.id): u.display_name for u in users}

    async def _users_any(self, org_id: str, ids: Sequence[str]) -> List[User]:
        if not ids:
            return []
        rows = await self.db.execute(
            select(User).where(User.id.in_(list(ids)), User.organization_id == org_id)
        )
        return list(rows.scalars().all())

    # ------------------------------------------------------------------
    # What they are told
    # ------------------------------------------------------------------

    @staticmethod
    def _context(
        notice: str,
        request: AttendanceWaiverRequest,
        action: AttendanceWaiverRequestAction,
        recipient: _Recipient,
        member_name: str,
        names: Dict[str, str],
    ) -> Dict[str, str]:
        title = request.event_title_snapshot
        day = _day(request.session_date)
        copy_note = (
            " You are receiving a copy for the department's records; no action "
            "is needed from you."
        )
        context: Dict[str, str] = {
            "recipient_name": recipient.name or "there",
            "member_name": member_name,
            "session_title": title,
            "session_date": day,
        }
        if notice == _REQUESTED:
            summary = f'{member_name} asked to be excused from "{title}" on {day}.'
            context.update(
                {
                    "summary": summary
                    + (copy_note if recipient.is_copy else " Approve or deny it."),
                    "reason_provided": "Yes" if request.reason else "No",
                    "category": (
                        NOT_IN_COPY
                        if recipient.is_copy
                        else (request.category or "None given")
                    ),
                    "review_buttons_html": (
                        ""
                        if recipient.is_copy
                        else review_buttons_html(str(request.id))
                    ),
                    "review_links_text": (
                        "No action is needed from you."
                        if recipient.is_copy
                        else (
                            f"Approve: {request_url(str(request.id), 'approve')}\n"
                            f"Deny: {request_url(str(request.id), 'deny')}\n"
                            "Each link opens the request in the Logbook, where "
                            "you confirm your decision."
                        )
                    ),
                }
            )
        elif notice == _DECIDED:
            outcome, word, phrase = _OUTCOMES[action.action]
            whose = f"{member_name}'s request" if recipient.is_copy else "Your request"
            context.update(
                {
                    "summary": f'{whose} to be excused from "{title}" on {day} '
                    f"{phrase}." + (copy_note if recipient.is_copy else ""),
                    "outcome": outcome,
                    "outcome_word": word,
                    "decided_by": names.get(str(action.actor_id), "An officer"),
                    "decision_note": (
                        NOT_IN_COPY if recipient.is_copy else (action.note or "None")
                    ),
                    "request_url": request_url(str(request.id)),
                }
            )
        else:
            context["summary"] = (
                f'{member_name} withdrew their request to be excused from "{title}" '
                f"on {day}." + (copy_note if recipient.is_copy else "")
            )
        return context

    # ------------------------------------------------------------------
    # Sending once
    # ------------------------------------------------------------------

    async def _send_once(
        self,
        service: EmailService,
        org_id: str,
        request: AttendanceWaiverRequest,
        action: AttendanceWaiverRequestAction,
        recipient: _Recipient,
        template_type: EmailTemplateType,
        context: Dict[str, str],
    ) -> bool:
        """Claim, send, then stamp or release. False when already claimed."""
        claim = AttendanceWaiverEmailSend(
            id=generate_uuid(),
            organization_id=org_id,
            request_id=str(request.id),
            action_id=str(action.id),
            recipient_key=recipient.key,
            is_copy=recipient.is_copy,
        )
        try:
            # The unique (action_id, recipient_key) is what stops a second
            # run: an existing claim, committed or in flight, refuses this one.
            async with self.db.begin_nested():
                self.db.add(claim)
                await self.db.flush()
        except IntegrityError:
            return False
        await self.db.commit()

        try:
            sent = await service.send_attendance_waiver_notice(
                template_type,
                recipient.email,
                context,
                db=self.db,
                organization_id=org_id,
            )
        except Exception:
            logger.exception(
                "Waiver email for action {} to {} raised", action.id, recipient.key
            )
            sent = False

        if sent:
            claim.sent_at = datetime.now(timezone.utc)
        else:
            # Released, so a retry can try this recipient again.
            await self.db.delete(claim)
        await self.db.commit()
        return sent
