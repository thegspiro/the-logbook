"""Member class and status, and the legacy ``membership_type`` they replace.

A member's standing is two independent facts, and ``membership_type`` was one
column holding both:

* **class** — what kind of member they are. Operational members ride;
  administrative members hold corporate office; social/associate members
  support the company without responding.
* **status** — where they are in the membership ladder: prospective,
  probationary, regular, life, retired.

Flattening the two is why the platform could not record a *probationary
treasurer* (administrative has no status) or say whether a *life member* still
rides (life has no class). It is also why ``ElectionService`` had to define
"operational" as ``membership_type == "active"``, which silently excludes every
probationary and life member from a rule that plainly means to include them.

``membership_type`` is still stored and is still what 160-odd call sites read,
so it is derived here rather than dropped. The derivation is lossy in one
direction on purpose — the legacy vocabulary cannot express an administrative
probationer — and the two new columns are the authority whenever they disagree.
"""

from typing import Optional, Tuple


class MemberClass:
    """What kind of member this is. Independent of how long they have been one."""

    OPERATIONAL = "operational"
    ADMINISTRATIVE = "administrative"
    SOCIAL = "social"

    ALL = (OPERATIONAL, ADMINISTRATIVE, SOCIAL)


class MemberStatus:
    """Where a member sits on the membership ladder. Independent of class."""

    PROSPECTIVE = "prospective"
    PROBATIONARY = "probationary"
    REGULAR = "regular"
    LIFE = "life"
    RETIRED = "retired"
    HONORARY = "honorary"
    JUNIOR = "junior"

    ALL = (
        PROSPECTIVE,
        PROBATIONARY,
        REGULAR,
        LIFE,
        RETIRED,
        HONORARY,
        JUNIOR,
    )


DEFAULT_CLASS = MemberClass.OPERATIONAL
DEFAULT_STATUS = MemberStatus.REGULAR

# Legacy ``membership_type`` -> (class, status).
#
# ``honorary`` maps to the social class rather than to operational, because
# that is what the system already did with it: honorary sits in
# ``DEFAULT_EXCLUDED_MEMBERSHIP_TYPES`` alongside administrative and retired,
# so an honorary member has never been able to self-sign up for a shift. Naming
# the class "social" records the behaviour that was already there instead of
# quietly widening it.
_SPLIT = {
    "prospective": (MemberClass.OPERATIONAL, MemberStatus.PROSPECTIVE),
    "probationary": (MemberClass.OPERATIONAL, MemberStatus.PROBATIONARY),
    "active": (MemberClass.OPERATIONAL, MemberStatus.REGULAR),
    "life": (MemberClass.OPERATIONAL, MemberStatus.LIFE),
    "retired": (MemberClass.OPERATIONAL, MemberStatus.RETIRED),
    "administrative": (MemberClass.ADMINISTRATIVE, MemberStatus.REGULAR),
    "honorary": (MemberClass.SOCIAL, MemberStatus.HONORARY),
}

# The operational statuses that have their own legacy spelling. Anything else
# on the operational class falls back to "active".
_OPERATIONAL_LEGACY = {
    MemberStatus.PROSPECTIVE: "prospective",
    MemberStatus.PROBATIONARY: "probationary",
    MemberStatus.REGULAR: "active",
    MemberStatus.LIFE: "life",
    MemberStatus.RETIRED: "retired",
    MemberStatus.HONORARY: "honorary",
    # A junior member is restricted in what they may do, and the legacy
    # vocabulary has no word for that. "probationary" is the closest existing
    # value that every gate already treats as limited.
    MemberStatus.JUNIOR: "probationary",
}


def split_membership_type(
    membership_type: Optional[str],
) -> Tuple[Optional[str], Optional[str]]:
    """Legacy ``membership_type`` -> ``(member_class, member_status)``.

    Returns ``(None, None)`` for a value this map does not know, and that is
    the important case rather than an edge one. ``membership_type`` also stores
    **membership tier ids**, which are org-configurable: ``POST
    /member-status/.../tier`` validates the id against
    ``organization.settings["membership_tiers"]`` and writes it straight into
    this column, and the shipped defaults already include ``senior``.

    Defaulting an unknown value to a regular operational member would promote
    every one of those tiers into categories they were never in. A Senior
    Member satisfied neither "operational" (which meant ``== "active"``) nor
    "regular" (``in (active, life)``) before; silently making them satisfy both
    would widen the electorate of any ballot restricted to either. ``None``
    means "this is not one of the seven, and we are not guessing" — it matches
    no class and no status, which is exactly what the value did before.

    An empty value is different and does resolve to the default: the column
    defaults to ``"active"``, so a member with nothing recorded is a regular
    operational one.
    """
    key = (membership_type or "").strip().lower()
    if not key:
        return (DEFAULT_CLASS, DEFAULT_STATUS)
    return _SPLIT.get(key, (None, None))


def derive_membership_type(
    member_class: Optional[str],
    member_status: Optional[str],
) -> str:
    """``(member_class, member_status)`` -> the legacy ``membership_type``.

    Lossy on purpose. The legacy vocabulary mixes class and status into one
    field, so it cannot express an administrative probationer or a social
    junior — both collapse onto the class. That loss is confined to the legacy
    column; the two real columns keep the full answer, and anything that needs
    it should read them instead.
    """
    cls = (member_class or DEFAULT_CLASS).strip().lower()
    status = (member_status or DEFAULT_STATUS).strip().lower()

    if cls == MemberClass.ADMINISTRATIVE:
        return "administrative"
    if cls == MemberClass.SOCIAL:
        # Every social status is non-riding, which is the one thing the legacy
        # gates use this value for.
        return "honorary"
    return _OPERATIONAL_LEGACY.get(status, "active")


#: Refused in these words by every path that could pair an administrative
#: member with an operational rank -- the create, the profile update and the
#: prospect conversion. One constant rather than three literals, for the same
#: reason ``rank_not_configured_message`` is one: an operator who hits the rule
#: on two different screens must not be told two different things.
ADMINISTRATIVE_RANK_MESSAGE = (
    "Administrative members do not hold an operational rank. "
    "Move the member to an operational class first, or leave the rank blank."
)


def effective_member_class(
    member_class: Optional[str],
    membership_type: Optional[str] = None,
) -> Optional[str]:
    """The class to judge a member by, whichever column the caller wrote.

    ``_reconcile_membership`` fills ``member_class`` at **flush**, not on
    assignment, so a request that has only set ``membership_type`` still sees a
    stale (or ``None``) class on the in-memory object. Any rule evaluated
    mid-request has to derive the class itself, which is what
    ``ElectionService._user_has_role_type`` already does by hand.

    Returns ``None`` for an unset class over a membership *tier* id the split
    map does not know. Callers must treat that as "not established", never as a
    default class: guessing is the widening ``split_membership_type`` refuses
    to do. An entirely empty pair is different and resolves to the default
    operational class, matching the column default.
    """
    if member_class and member_class.strip():
        return member_class.strip().lower()
    return split_membership_type(membership_type)[0]


def is_administrative(
    member_class: Optional[str],
    membership_type: Optional[str] = None,
) -> bool:
    """Whether this member is administrative, and therefore holds no rank.

    Asks specifically about the administrative class rather than about the
    absence of the operational one. The difference is not stylistic: a custom
    membership tier resolves to ``None`` (see ``split_membership_type``), so
    ``not is_operational(...)`` is true for every department running a
    configured tier like ``senior`` -- and would strip their ranks.
    """
    return effective_member_class(member_class, membership_type) == (
        MemberClass.ADMINISTRATIVE
    )


def is_non_riding_class(
    member_class: Optional[str],
    membership_type: Optional[str] = None,
) -> bool:
    """Whether this member's *class* keeps them out of a crew seat.

    Administrative and social members do not ride. Asked as "is one of the two
    classes that cannot" rather than "is not operational", for the reason
    ``is_administrative`` gives: a department running an org-configured
    membership tier resolves to ``None``, and reading that as non-operational
    is the widening ``split_membership_type`` refuses to make. An open-to-all
    shift gated on ``== OPERATIONAL`` disappeared from the schedule of every
    member the shipped ``senior`` tier had auto-advanced.

    Class only. Status — probationary, retired, junior — is a separate
    question, answered by the membership-type gate.
    """
    return effective_member_class(member_class, membership_type) in (
        MemberClass.ADMINISTRATIVE,
        MemberClass.SOCIAL,
    )


def is_operational(member_class: Optional[str]) -> bool:
    """Whether this member is on the operational side of the house.

    True for every operational status — prospective through retired — because
    class and status are separate questions. A life member is operational; so
    is a probationary one. Reading ``membership_type == "active"`` for this,
    as the election service did, answers a narrower question than it looks.

    ``None`` is **not** operational. An unset class means the member's
    ``membership_type`` is a custom tier this map does not know, and claiming
    those for the operational body is the widening this function exists to
    avoid — defaulting here would reintroduce it one layer down.
    """
    if not member_class:
        return False
    return member_class.strip().lower() == MemberClass.OPERATIONAL
