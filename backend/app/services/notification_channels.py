"""Channel policy: what a notification may do *in addition to* sending email.

Email is this application's primary notification channel and its channel of
record. Anything a member or officer has to act on is emailed; every other
channel — the in-app bell, web push, SMS — is an addition layered on top of
that email, never a substitute for it. A member who reads only their inbox
must never miss something, because email is the only channel the department
can later prove reached them.

SMS is the one addition that costs money per message, reaches people outside
working hours, and is legally constrained (US TCPA requires express prior
consent for text messaging), so it is deliberately the narrowest channel in
the system:

* It is limited to the alerts named in :class:`SmsAlert`, and that list is
  exhaustive. Giving some new notification a text means adding a member here —
  a visible, reviewable change — rather than a call site nobody notices.
* Every alert on that list is time-critical and directed at a person who may
  need to act immediately. Operational and administrative notices — low-stock
  and reorder alerts, overdue-property digests, renewal and deadline
  reminders, anything whose recipient acts on it during business hours — are
  email-only by policy. A quartermaster does not need a 2am text to learn the
  department is low on gloves.
* It is opt-in twice over: a recorded TCPA consent (which fails closed, so a
  member who was never asked counts as having refused) and the member's own
  ``sms_notifications`` preference, which mutes texts without touching the
  emails they keep receiving.

Routing recipients through :func:`resolve_sms_targets` (or its number-only
wrapper :func:`resolve_sms_recipients`) is what keeps those
rules in one place. Call sites must not rebuild the enabled/consent/preference
/number filter themselves — the 2026-08 sweep found the low-stock task had
grown its own copy, which is how a routine reorder notice ended up sending
texts.
"""

import enum
from typing import Any, List, Optional, Sequence, Tuple

from sqlalchemy.ext.asyncio import AsyncSession


class SmsAlert(str, enum.Enum):
    """The complete set of notifications permitted to escalate to SMS.

    Membership in this enum *is* the allowlist: anything without a member here
    is email-only. Before adding one, check the notice is genuinely
    time-critical for the person receiving it — see the module docstring.
    """

    # A department message an officer explicitly marked urgent. The member is
    # emailed regardless; the text exists to shorten the time to being read.
    URGENT_DEPARTMENT_MESSAGE = "urgent_department_message"


def wants_channel(preferences: Optional[dict], key: str) -> bool:
    """Whether a member opts in to an additional channel.

    Defaults to True when the key is unset, so a member only stops receiving a
    channel by explicitly turning it off — a preferences blob written before
    the key existed must not silently mute anyone.
    """
    return (preferences or {}).get(key, True) is not False


async def resolve_sms_targets(
    db: AsyncSession,
    users: Sequence[Any],
    alert: SmsAlert,
) -> List[Tuple[str, str]]:
    """``(user_id, number)`` pairs that may be texted for *alert*.

    Identity travels with the number because a number does not identify a
    member: two people sharing a handset — a married couple in a volunteer
    department is ordinary — have one number between them. A caller that gets
    back bare numbers has to rebuild the pairing by matching on the number,
    which picks whichever member comes first in its own list rather than the
    one who actually cleared the consent gates, and files the delivery record
    against them.

    Same gates and same ordering as :func:`resolve_sms_recipients`, which is
    now this function with the identities dropped.
    """
    if not isinstance(alert, SmsAlert):
        raise ValueError(
            f"{alert!r} is not an SMS-eligible alert. Notifications are "
            "email-first; add a member to SmsAlert if this one genuinely "
            "warrants a text."
        )

    from app.services.sms_service import SMSService

    if not SMSService().enabled:
        return []

    from app.models.consent import ConsentType
    from app.services.consent_service import ConsentService

    # Bulk lookup rather than per-recipient: a department message can target
    # the whole roster, and an N+1 here sits directly on the send path.
    consented = await ConsentService(db).granted_user_ids(
        [str(u.id) for u in users], ConsentType.SMS_NOTIFICATIONS
    )

    return [
        (str(u.id), number)
        for u in users
        if (number := (getattr(u, "mobile", None) or getattr(u, "phone", None)))
        and str(u.id) in consented
        and wants_channel(
            getattr(u, "notification_preferences", None), "sms_notifications"
        )
    ]


async def resolve_sms_recipients(
    db: AsyncSession,
    users: Sequence[Any],
    alert: SmsAlert,
) -> List[str]:
    """Phone numbers that may be texted for *alert*, in *users* order.

    Returns an empty list — meaning "email only, and that is the correct
    outcome" — when the alert is not SMS-eligible, Twilio is not configured,
    or no recipient cleared both opt-in gates.

    Raises ``ValueError`` if *alert* is not an :class:`SmsAlert` member. A
    plain string reaching here means a call site invented its own alert name to
    get around the allowlist; fan-out callers guard their channel methods, so
    this surfaces as a logged warning and no texts, not a failed notification.

    Prefer :func:`resolve_sms_targets` when the caller records anything per
    member: this drops the identities, and a number cannot be matched back to
    the member who consented once two of them share a handset.
    """
    return [number for _, number in await resolve_sms_targets(db, users, alert)]
