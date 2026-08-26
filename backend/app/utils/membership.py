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
) -> Tuple[str, str]:
    """Legacy ``membership_type`` -> ``(member_class, member_status)``.

    An unrecognised value resolves to a regular operational member, matching
    the column default. The column is a free string with no enum constraint, so
    unrecognised values genuinely occur.
    """
    return _SPLIT.get(
        (membership_type or "").strip().lower(), (DEFAULT_CLASS, DEFAULT_STATUS)
    )


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


def is_operational(member_class: Optional[str]) -> bool:
    """Whether this member is on the operational side of the house.

    True for every operational status — prospective through retired — because
    class and status are separate questions. A life member is operational; so
    is a probationary one. Reading ``membership_type == "active"`` for this,
    as the election service did, answers a narrower question than it looks.
    """
    return (member_class or DEFAULT_CLASS).strip().lower() == MemberClass.OPERATIONAL
