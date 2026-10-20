"""Counting a vote on a motion, and what the count says about the result.

A motion is decided by a threshold the body chooses for it, and a vote is
either entered as totals or recorded member by member in a roll call. This is
the one definition of both, so the form, the stored record and the printed
copy cannot disagree about what "passed" means.

Thresholds
    ``majority_cast`` (the default)
        More votes for than against. An abstention or a recusal is not a vote
        cast, so it neither helps nor hurts, and a tie fails.
    ``majority_present``
        More than half of the members present vote for. Abstentions and
        recusals therefore count against, as they do under bylaws that ask for
        a majority of those in the room.
    ``two_thirds``
        At least two thirds of the votes cast are for. A body that sets this
        for an amendment or a suspension of the rules has already decided that
        abstentions do not count.

The result a threshold gives is a **suggestion**. The secretary records what the
chair announced, which is not always what the arithmetic says (a motion carried
by unanimous consent has no count at all), so the stored status is the
secretary's and this only says what the numbers support.
"""

from typing import Any, Dict, Iterable, List, Mapping, Optional

from app.utils.minutes_attendance import counts_toward_quorum

THRESHOLDS = ("majority_cast", "majority_present", "two_thirds")
DEFAULT_THRESHOLD = "majority_cast"

VOTES = ("yes", "no", "abstain", "recuse")


def tally(roll_call: Iterable[Mapping[str, Any]]) -> Dict[str, int]:
    """The totals a roll call adds up to."""
    counts = {"yes": 0, "no": 0, "abstain": 0, "recuse": 0}
    for entry in roll_call:
        vote = entry.get("vote")
        if vote in counts:
            counts[str(vote)] += 1
    return {
        "votes_for": counts["yes"],
        "votes_against": counts["no"],
        "votes_abstain": counts["abstain"],
        "votes_recused": counts["recuse"],
    }


def suggested_status(
    threshold: Optional[str],
    votes_for: Optional[int],
    votes_against: Optional[int],
    present: int,
) -> Optional[str]:
    """``passed`` or ``failed`` when the counts decide it, else None.

    None when no for-count was recorded: a motion carried by voice or consent
    has nothing to compute, and guessing would put a number's authority behind
    the secretary's own judgement. ``present`` is the number of members in the
    room, used only by ``majority_present``.
    """
    if votes_for is None:
        return None
    against = votes_against or 0
    kind = threshold if threshold in THRESHOLDS else DEFAULT_THRESHOLD
    if kind == "majority_present":
        return "passed" if votes_for * 2 > present else "failed"
    if kind == "two_thirds":
        cast = votes_for + against
        return "passed" if cast > 0 and votes_for * 3 >= cast * 2 else "failed"
    return "passed" if votes_for > against else "failed"


def members_present(attendees: Optional[Iterable[Mapping[str, Any]]]) -> int:
    """How many members were in the room, by the roll call of the minutes."""
    return sum(1 for a in attendees or [] if counts_toward_quorum(a))


def settle_roll_call(
    roll_call: Iterable[Mapping[str, Any]],
    attendees: Optional[Iterable[Mapping[str, Any]]],
) -> List[Dict[str, Any]]:
    """The stored form of a roll call, checked against the minutes' own roll.

    Only members recorded present can vote, each once, and the member's id is
    taken from the roll rather than from the request: a vote is attributed to
    the person the minutes say was there, not to whoever the client names.
    Raises ``ValueError`` naming the problem, which reaches the caller as a 400.
    """
    here: Dict[str, Optional[str]] = {}
    for attendee in attendees or []:
        if counts_toward_quorum(attendee):
            name = str(attendee.get("name") or "").strip()
            if name:
                here.setdefault(name, attendee.get("user_id") or None)

    settled: List[Dict[str, Any]] = []
    seen: set[str] = set()
    for entry in roll_call:
        name = str(entry.get("name") or "").strip()
        if name not in here:
            raise ValueError(f"{name or 'That person'} is not recorded as present")
        if name in seen:
            raise ValueError(f"{name} appears twice in the roll call")
        if entry.get("vote") not in VOTES:
            raise ValueError(f"{name}'s vote must be yes, no, abstain or recuse")
        seen.add(name)
        settled.append({"user_id": here[name], "name": name, "vote": entry["vote"]})
    return settled


_THRESHOLD_NOTE = {
    "majority_present": "majority of members present required",
    "two_thirds": "two-thirds of votes cast required",
}


def vote_summary(motion: Any) -> str:
    """The vote as the printed and published minutes state it, or ``""``.

    Totals and the threshold only. Who voted which way is kept on the record
    and shown in the app, and deliberately left off the copies that leave it.
    """
    votes_for = getattr(motion, "votes_for", None)
    if votes_for is None:
        return ""
    text = f"Vote {votes_for}-{getattr(motion, 'votes_against', None) or 0}"
    extras = []
    if getattr(motion, "votes_abstain", None):
        extras.append(f"{motion.votes_abstain} abstain")
    if getattr(motion, "votes_recused", None):
        extras.append(f"{motion.votes_recused} recused")
    note = _THRESHOLD_NOTE.get(getattr(motion, "threshold", None) or "")
    if note:
        extras.append(note)
    return text + (f" ({', '.join(extras)})" if extras else "")


ACCEPTANCE_LABELS = {
    "as_submitted": "Accepted as submitted",
    "as_revised": "Accepted as revised",
}


def recorded_motions(motions):
    """The motions the meeting acted on, in their given order.

    A prepared motion the meeting has not acted on is ``pending``: wording with
    no mover and no vote. It is not part of the record, so nothing printed,
    published, posted or sealed includes it.
    """
    return [
        m
        for m in (motions or [])
        if (m.status if isinstance(m.status, str) else m.status.value) != "pending"
    ]


def acceptance_label(motion) -> str | None:
    """ "Accepted as submitted/revised", for a passed previous-minutes motion."""
    value = getattr(motion, "acceptance", None)
    status = motion.status if isinstance(motion.status, str) else motion.status.value
    return ACCEPTANCE_LABELS.get(value) if value and status == "passed" else None
