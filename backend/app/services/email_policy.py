"""Which emails a member may opt out of, and which they always receive.

Every member-facing email belongs in :data:`EMAIL_POLICIES`, classified once:

* **Required** — the department must be able to show the member was told, so
  no preference can stop it. Elections are the example the department named:
  a ballot notice can never be switched off.
* **Optional** — the member may turn it off. ``default_on`` is what a member
  receives before they have made any choice.

Senders ask :func:`member_receives_email` rather than reading preferences
themselves. Before this module each sender decided on its own, and they
disagreed: reminders and certificate alerts honoured the member's
``email_notifications`` switch, while department messages, suggestion notices
and the inventory digest ignored it. Classifying a kind here is a visible,
reviewable decision instead of a call site nobody notices — the same reason
``SmsAlert`` exists for texts.

The list starts with the equipment request notice. Existing senders move onto
it one at a time, each classified as it moves; until then they keep their own
behaviour. The member-facing controls for optional kinds are not built yet, so
an optional kind currently reaches everyone its ``default_on`` says it should.
The per-kind choice is read from ``notification_preferences["email_kinds"]``
now, so those controls only have to write it.

The in-app bell entry is not governed here. It is how a member finds out
inside the application, and turning off an email never removes it.
"""

import enum
from dataclasses import dataclass
from typing import Any, Mapping, Optional


class EmailKind(str, enum.Enum):
    """A category of member-facing email, as the member would think of it."""

    EQUIPMENT_REQUEST_UPDATE = "equipment_request_update"


@dataclass(frozen=True)
class EmailPolicy:
    label: str
    required: bool
    default_on: bool = True


EMAIL_POLICIES: Mapping[EmailKind, EmailPolicy] = {
    # A decision about the member's own request. Optional because the in-app
    # notice and My Equipment carry the same news; on by default because a
    # member waiting on gear should hear without having to go and look.
    EmailKind.EQUIPMENT_REQUEST_UPDATE: EmailPolicy(
        label="Equipment request updates",
        required=False,
        default_on=True,
    ),
}

# Where a member's per-kind choices live inside User.notification_preferences:
# {"email_kinds": {"equipment_request_update": false}}.
PREFERENCE_KEY = "email_kinds"


def member_receives_email(
    preferences: Optional[Mapping[str, Any]], kind: EmailKind
) -> bool:
    """Whether a member with *preferences* is emailed a notice of *kind*.

    A required kind is always sent. An optional kind follows the member's
    explicit choice when there is one, and its ``default_on`` otherwise. A
    malformed preference is treated as no choice: a bad value in a JSON blob
    must not silently stop someone's email.
    """
    policy = EMAIL_POLICIES[kind]
    if policy.required:
        return True
    choices = (preferences or {}).get(PREFERENCE_KEY)
    if isinstance(choices, Mapping):
        choice = choices.get(kind.value)
        if isinstance(choice, bool):
            return choice
    return policy.default_on
