"""Which emails a member may opt out of, and which they always receive.

Every email this application sends to a member's account belongs to one
:class:`EmailKind` in :data:`EMAIL_POLICIES`, classified once:

* **Required** — the department must be able to show the member was told, so
  no preference can stop it: sign-in and security mail, ballots, department
  messages, receipts, and notices about property the member holds.
* **Optional** — the member may turn it off. ``default_on`` is what a member
  receives before they have made any choice.

Senders ask :func:`member_receives_email` (or :func:`recipients_for`) rather
than reading preferences themselves. Before this module each sender decided on
its own and they disagreed: some honoured the member's ``email_notifications``
switch, most ignored it, so the switch did not do what its label said.
Classifying a kind here is a visible, reviewable decision instead of a call
site nobody notices — the same reason ``SmsAlert`` exists for texts. The
Member Emails & Texts page lists this table for administrators.

How an optional kind is decided, in order:

1. ``email_notifications`` off turns every optional kind off. It is the switch
   members already have, labelled as covering reminders and alerts.
2. The member's explicit choice for the kind, in
   ``notification_preferences["email_kinds"]``.
3. The older per-topic switch the kind replaces (``event_reminders``,
   ``training_reminders``), so a member who turned one off stays off.
4. ``default_on``.

A department's leadership can make any optional kind required for its own
members, on the Member Emails & Texts page. That wins over every step above,
and members see the kind as always sent rather than as a choice. Only that
direction is allowed: nothing a department sets can make a system-required
kind optional.

Not governed here: mail to people who are not members (applicants, event
requesters, outside approvers), addresses an administrator types in (report
recipients, CC lists, test sends), and the in-app bell entry, which is how a
member finds out inside the application and which turning off an email never
removes.
"""

import enum
from dataclasses import dataclass
from typing import (
    AbstractSet,
    Any,
    FrozenSet,
    Iterable,
    List,
    Mapping,
    Optional,
    Sequence,
    TypeVar,
)


class EmailKind(str, enum.Enum):
    """A category of member-facing email, as the member would think of it.

    The values are stored in members' preferences, so renaming one discards
    every choice made for it.
    """

    # Required
    ACCOUNT_SECURITY = "account_security"
    ELECTION_BALLOTS = "election_ballots"
    DEPARTMENT_MESSAGES = "department_messages"
    DEPARTURE_NOTICES = "departure_notices"
    STORE_RECEIPTS = "store_receipts"
    SKILLS_TEST_RESULTS = "skills_test_results"
    OVERDUE_EQUIPMENT = "overdue_equipment"
    TRAINING_RECORD_CHANGES = "training_record_changes"

    # Optional, about the member's own activity
    EVENT_REMINDERS = "event_reminders"
    TRAINING_REMINDERS = "training_reminders"
    SHIFT_NOTICES = "shift_notices"
    INVENTORY_UPDATES = "inventory_updates"
    STORE_ANNOUNCEMENTS = "store_announcements"
    VOLUNTEER_CALLS = "volunteer_calls"
    ELECTION_NOTICES = "election_notices"
    SUGGESTION_BOX = "suggestion_box"

    # Optional, sent to officers because of a role they hold
    EVENT_DUTIES = "event_duties"
    SCHEDULING_DUTIES = "scheduling_duties"
    TRAINING_DUTIES = "training_duties"
    ELECTION_ADMIN = "election_admin"
    INVENTORY_DUTIES = "inventory_duties"
    MEMBERSHIP_ADMIN = "membership_admin"


class EmailAudience(str, enum.Enum):
    MEMBERS = "members"
    OFFICERS = "officers"


@dataclass(frozen=True)
class EmailPolicy:
    label: str
    required: bool
    audience: EmailAudience
    # What the kind covers, as an administrator would recognise each email.
    includes: Sequence[str]
    # Why it is required, or what turning it off costs; shown to admins.
    rationale: str
    default_on: bool = True
    # The older per-topic preference this kind replaces, still honoured.
    legacy_preference: Optional[str] = None


_M = EmailAudience.MEMBERS
_O = EmailAudience.OFFICERS

EMAIL_POLICIES: Mapping[EmailKind, EmailPolicy] = {
    EmailKind.ACCOUNT_SECURITY: EmailPolicy(
        label="Account and security",
        required=True,
        audience=_M,
        includes=(
            "Password reset",
            "Welcome and sign-in details",
            "Security alerts (two-factor changes, recovery codes)",
        ),
        rationale="A member cannot sign in or secure their account without these.",
    ),
    EmailKind.ELECTION_BALLOTS: EmailPolicy(
        label="Election ballots",
        required=True,
        audience=_M,
        includes=("Ballots and voting links",),
        rationale="Every eligible voter must receive their ballot.",
    ),
    EmailKind.DEPARTMENT_MESSAGES: EmailPolicy(
        label="Department messages",
        required=True,
        audience=_M,
        includes=("Messages sent from Communications > Messages",),
        rationale=(
            "Email is the channel of record for department announcements; "
            "urgent ones may also be texted to members who agreed to texts."
        ),
    ),
    EmailKind.DEPARTURE_NOTICES: EmailPolicy(
        label="Leaving the department",
        required=True,
        audience=_M,
        includes=("Separation notice", "Property return reminders"),
        rationale=("A formal notice about department property the member still holds."),
    ),
    EmailKind.STORE_RECEIPTS: EmailPolicy(
        label="Store receipts",
        required=True,
        audience=_M,
        includes=(
            "Order confirmation",
            "Payment received",
            "Order updates and cancellations",
        ),
        rationale="A record of the member's own purchase and payment.",
    ),
    EmailKind.SKILLS_TEST_RESULTS: EmailPolicy(
        label="Skills test results",
        required=True,
        audience=_M,
        includes=("Results an officer chooses to email",),
        rationale="Sent deliberately by an officer, one member at a time.",
    ),
    EmailKind.OVERDUE_EQUIPMENT: EmailPolicy(
        label="Overdue equipment",
        required=True,
        audience=_M,
        includes=("Checked-out equipment past its return date",),
        rationale="Department property the member is responsible for.",
    ),
    EmailKind.TRAINING_RECORD_CHANGES: EmailPolicy(
        label="Changes to your training record",
        required=True,
        audience=_M,
        includes=(
            "An officer voided one of your training records, and why",
            "An officer edited one of your training records",
        ),
        rationale=(
            "Changes to the member's official training record, which they "
            "need to know about to question one."
        ),
    ),
    EmailKind.EVENT_REMINDERS: EmailPolicy(
        label="Event reminders",
        required=False,
        audience=_M,
        includes=(
            "Reminders before events",
            "An event series you created is ending",
            "The answer to an attendance request you made",
        ),
        rationale="The events calendar and the bell carry the same dates.",
        legacy_preference="event_reminders",
    ),
    EmailKind.TRAINING_REMINDERS: EmailPolicy(
        label="Training and certification reminders",
        required=False,
        audience=_M,
        includes=("Certifications expiring or expired",),
        rationale=(
            "Officers are still copied on escalations when the department "
            "has escalation turned on."
        ),
        legacy_preference="training_reminders",
    ),
    EmailKind.SHIFT_NOTICES: EmailPolicy(
        label="Shift notices",
        required=False,
        audience=_M,
        includes=(
            "Shift reminders",
            "Shift assignments",
            "Shift swap expired",
            "End-of-shift summary",
            "Overdue trainee shift reports",
        ),
        rationale="The schedule and the bell carry the same information.",
    ),
    EmailKind.INVENTORY_UPDATES: EmailPolicy(
        label="Equipment and inventory updates",
        required=False,
        audience=_M,
        includes=(
            "Equipment request approved, declined or issued",
            "Changes to the gear assigned to you",
        ),
        rationale="My Equipment and the bell carry the same news.",
    ),
    EmailKind.STORE_ANNOUNCEMENTS: EmailPolicy(
        label="Store announcements",
        required=False,
        audience=_M,
        includes=(
            "Ordering window open, closing or closed",
            "Payment reminders",
            "Vendor order updates",
        ),
        rationale="Receipts for the member's own orders are still sent.",
    ),
    EmailKind.VOLUNTEER_CALLS: EmailPolicy(
        label="Volunteer calls",
        required=False,
        audience=_M,
        includes=("Calls for members to cover community events",),
        rationale="Open signups also appear on the schedule.",
    ),
    EmailKind.ELECTION_NOTICES: EmailPolicy(
        label="Election notices",
        required=False,
        audience=_M,
        includes=("Nominations are open", "You have been nominated"),
        rationale="The ballot itself is always sent.",
    ),
    EmailKind.SUGGESTION_BOX: EmailPolicy(
        label="Suggestion box",
        required=False,
        audience=_M,
        includes=(
            "New submissions, replies and forwards, for reviewers",
            "Updates on a submission you made",
        ),
        rationale="The suggestion box and the bell carry the same notices.",
    ),
    EmailKind.EVENT_DUTIES: EmailPolicy(
        label="Event officer duties",
        required=False,
        audience=_O,
        includes=(
            "Attendance to validate after an event",
            "A member asked to be marked present at your event",
            "You were made an event's organizer or alternate, or relieved of it",
            "An event request was assigned to you",
        ),
        rationale="The task also waits in the bell and on the event.",
    ),
    EmailKind.SCHEDULING_DUTIES: EmailPolicy(
        label="Scheduling officer duties",
        required=False,
        audience=_O,
        includes=(
            "A member declined a shift",
            "Shift drafts finalized",
            "Attendance to validate after a shift",
        ),
        rationale="The task also waits in the bell and on the schedule.",
    ),
    EmailKind.TRAINING_DUTIES: EmailPolicy(
        label="Training officer duties",
        required=False,
        audience=_O,
        includes=(
            "Training sessions awaiting approval",
            "New provider course versions to map",
        ),
        rationale=(
            "Pending approvals are also listed in Training, and unmapped "
            "courses under the provider's Mappings."
        ),
    ),
    EmailKind.ELECTION_ADMIN: EmailPolicy(
        label="Election administration",
        required=False,
        audience=_O,
        includes=(
            "Election rolled back or deleted",
            "Election results report sent automatically when voting closes",
        ),
        rationale=(
            "The same records are kept on the election. A report or "
            "eligibility summary an officer asks for is always sent."
        ),
    ),
    EmailKind.INVENTORY_DUTIES: EmailPolicy(
        label="Quartermaster duties",
        required=False,
        audience=_O,
        includes=(
            "Low stock",
            "Shelf audit digest",
            "Gear due for retirement",
            "Supplies expiring or to restock",
            "Failed equipment checks",
        ),
        rationale="Inventory shows the same alerts.",
    ),
    EmailKind.MEMBERSHIP_ADMIN: EmailPolicy(
        label="Membership and store administration",
        required=False,
        audience=_O,
        includes=(
            "An applicant withdrew",
            "Property return summary",
            "Member archived",
            "New store orders",
        ),
        rationale="The same records are kept in Membership and the store.",
    ),
}

# Where a member's per-kind choices live inside User.notification_preferences:
# {"email_kinds": {"shift_notices": false}}.
PREFERENCE_KEY = "email_kinds"
MASTER_SWITCH = "email_notifications"

# Where a department's own additions to the required list live, inside
# Organization.settings: {"email_policy": {"required_kinds": ["shift_notices"]}}.
ORG_SETTINGS_KEY = "email_policy"
ORG_REQUIRED_KEY = "required_kinds"

OPTIONAL_KINDS = frozenset(k for k, p in EMAIL_POLICIES.items() if not p.required)

DepartmentRequired = AbstractSet[EmailKind]


def department_required_kinds(organization: Any) -> FrozenSet[EmailKind]:
    """The optional kinds this department has made required for its members.

    Leadership can only move a kind from optional to required, never the
    reverse, so anything here that is not an optional kind is ignored — as is
    a malformed value, which must not start or stop anyone's email.
    Takes an Organization (or anything with ``settings``), or None.
    """
    settings = getattr(organization, "settings", None)
    if not isinstance(settings, Mapping):
        return frozenset()
    section = settings.get(ORG_SETTINGS_KEY)
    if not isinstance(section, Mapping):
        return frozenset()
    stored = section.get(ORG_REQUIRED_KEY)
    if not isinstance(stored, (list, tuple)):
        return frozenset()
    optional = {kind.value: kind for kind in OPTIONAL_KINDS}
    return frozenset(
        optional[v] for v in stored if isinstance(v, str) and v in optional
    )


def is_required(kind: EmailKind, department_required: DepartmentRequired) -> bool:
    """Required by the system, or by this department."""
    return EMAIL_POLICIES[kind].required or kind in department_required


def member_receives_email(
    preferences: Optional[Mapping[str, Any]],
    kind: EmailKind,
    department_required: DepartmentRequired,
) -> bool:
    """Whether a member with *preferences* is emailed a notice of *kind*.

    *department_required* is :func:`department_required_kinds` for the
    member's organization. It is a required argument on purpose: a sender that
    left it out would quietly let members opt out of an email their
    department made mandatory.

    The order of decisions is in the module docstring. A malformed preference
    is treated as no choice: a bad value in a JSON blob must not silently stop
    someone's email.
    """
    if is_required(kind, department_required):
        return True
    prefs = preferences if isinstance(preferences, Mapping) else {}
    if prefs.get(MASTER_SWITCH) is False:
        return False
    return member_choice(prefs, kind)


def member_choice(preferences: Optional[Mapping[str, Any]], kind: EmailKind) -> bool:
    """The member's own setting for an optional *kind*, ignoring the master
    switch and any department requirement — steps 2 to 4 of the order in the
    module docstring.

    This is what a per-kind toggle shows. It is kept separate so turning
    Email notifications off and on again restores every toggle as it was,
    and so a kind the department stops requiring returns to the member's own
    earlier choice.
    """
    policy = EMAIL_POLICIES[kind]
    if policy.required:
        return True
    prefs = preferences if isinstance(preferences, Mapping) else {}
    choices = prefs.get(PREFERENCE_KEY)
    if isinstance(choices, Mapping):
        choice = choices.get(kind.value)
        if isinstance(choice, bool):
            return choice
    if policy.legacy_preference and prefs.get(policy.legacy_preference) is False:
        return False
    return policy.default_on


_U = TypeVar("_U")


def recipients_for(
    users: Iterable[_U], kind: EmailKind, department_required: DepartmentRequired
) -> List[_U]:
    """The members of *users* who receive *kind*, in their original order.

    Takes anything with a ``notification_preferences`` attribute — ORM users
    or the lightweight rows some senders select.
    """
    return [
        user
        for user in users
        if member_receives_email(
            getattr(user, "notification_preferences", None), kind, department_required
        )
    ]


def clean_email_kind_choices(value: Any) -> dict:
    """Keep only choices a member may make: optional kinds, as booleans.

    A required kind cannot be switched off, so a stored ``false`` for one
    would only mislead whoever reads the blob next.
    """
    if not isinstance(value, Mapping):
        return {}
    optional = {kind.value for kind in OPTIONAL_KINDS}
    return {
        key: choice
        for key, choice in value.items()
        if key in optional and isinstance(choice, bool)
    }
