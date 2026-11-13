"""Per-member-type voting rules: eligibility rules version 2.

Version 2 rules hold one complete row of rules per member type -- may vote,
a waiting period and its start, and the meeting-attendance rules -- and
nothing else. They replace both the version 1 election-wide rules and each
membership tier's own voting benefits, so a department sets who may vote in
one place (Election Settings) and every screen that reports it reads it from
here.

A member is judged by the row for their status, or for their department tier
when it has a row of its own, and -- when they are administrative or social
-- also by the row for their class. Both must pass (owner decision
2026-11-13): that is what the tier rules did, since a tier follows a member's
status whatever their class, so converting a department's tier rules into
rows takes no vote away from anyone who had one on that basis.

``rules_from_v1`` is the one conversion from a version 1 rule set plus the
tier ladder. It is applied when the department's defaults are read, never
written back, so a department that has not yet saved version 2 rules sees,
and gets, exactly what its stored rules and tiers say.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from typing import TYPE_CHECKING, Any, Dict, List, Mapping, Optional, Sequence

from dateutil.relativedelta import relativedelta

from app.utils.membership import (
    VOTER_TYPE_KEYS,
    VOTER_TYPE_LABELS,
    MemberClass,
    MemberStatus,
    canonical_member_status,
    effective_member_class,
    member_standing,
    ranks_as_from_tiers,
    tier_benefits,
    tier_for_status,
)

if TYPE_CHECKING:
    from app.services.membership_tier_service import MembershipTierService

RULES_VERSION = 2
CLASS_ROW_KEYS = (MemberClass.ADMINISTRATIVE, MemberClass.SOCIAL)

# Regular first because it is the row most departments set; the department's
# own tiers follow it, then the remaining statuses, then the classes, whose
# rows apply on top of a status row.
_STATUS_ROWS_AFTER_TIERS = (
    MemberStatus.LIFE,
    MemberStatus.PROBATIONARY,
    MemberStatus.RETIRED,
    MemberStatus.HONORARY,
    MemberStatus.JUNIOR,
    MemberStatus.PROSPECTIVE,
)
_BUILTIN_LABELS = {**VOTER_TYPE_LABELS, MemberStatus.PROSPECTIVE: "Prospective"}
_MEMBER_SUFFIXES = (" members", " member")


def is_type_rules(rules: Any) -> bool:
    """Whether ``rules`` is a version 2 (per-type) rule set."""
    return isinstance(rules, Mapping) and rules.get("version") == RULES_VERSION


def _tier_label(tier: Mapping[str, Any]) -> str:
    # Tier names carry their own noun ("Senior Member"); every reason below
    # reads "<label> members ...", so the noun is dropped where it is one.
    name = str(tier.get("name") or tier.get("id") or "").strip()
    lowered = name.lower()
    for suffix in _MEMBER_SUFFIXES:
        if lowered.endswith(suffix) and len(name) > len(suffix):
            return name[: -len(suffix)].strip()
    return name


def voter_rows(tiers: Sequence[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """The member types a version 2 rule set has rows for, in display order.

    Every built-in status, every department tier that is not one, and the
    two classes. Every status has a row whether or not the ladder has a tier
    for it, so no member falls outside the table. ``counts_as`` names the
    status whose row judges a department tier while it has no row of its own.
    """
    ranks_as = ranks_as_from_tiers(tiers)
    rows: List[Dict[str, Any]] = [
        {
            "key": MemberStatus.REGULAR,
            "label": _BUILTIN_LABELS[MemberStatus.REGULAR],
            "decided_by": "status",
            "counts_as": None,
        }
    ]
    seen = {MemberStatus.REGULAR}
    for tier in tiers:
        key = canonical_member_status(tier.get("id"))
        if not key or key in MemberStatus.ALL or key in seen:
            continue
        seen.add(key)
        rows.append(
            {
                "key": key,
                "label": _tier_label(tier),
                "decided_by": "status",
                "counts_as": ranks_as.get(key),
            }
        )
    for key in _STATUS_ROWS_AFTER_TIERS:
        rows.append(
            {
                "key": key,
                "label": _BUILTIN_LABELS[key],
                "decided_by": "status",
                "counts_as": None,
            }
        )
    for key in CLASS_ROW_KEYS:
        rows.append(
            {
                "key": key,
                "label": _BUILTIN_LABELS[key],
                "decided_by": "class",
                "counts_as": None,
            }
        )
    return rows


def row_labels(tiers: Sequence[Dict[str, Any]]) -> Dict[str, str]:
    """key -> how the row is named to a person."""
    return {row["key"]: row["label"] for row in voter_rows(tiers)}


def member_row_keys(
    member: Any, types: Mapping[str, Any], ranks_as: Mapping[str, str]
) -> List[str]:
    """The rows of ``types`` that judge ``member``: their status row, then
    their class row when they are administrative or social.

    A department tier without a row of its own falls back to the row of the
    status it counts as, which is how a tier added after the rules were
    saved is judged until it is given one. A member with no row at all is
    judged by no per-type rule.
    """
    keys: List[str] = []
    status = canonical_member_status(member_standing(member) or MemberStatus.REGULAR)
    if status and status not in types and status not in MemberStatus.ALL:
        status = ranks_as.get(status) or status
    if status and status in types:
        keys.append(status)
    klass = effective_member_class(
        getattr(member, "member_class", None), getattr(member, "membership_type", None)
    )
    if klass in CLASS_ROW_KEYS and klass in types:
        keys.append(klass)
    return keys


def _positive_int(value: Any) -> Optional[int]:
    """``value`` if it is a positive whole number, else None. ``bool`` is an
    ``int`` subclass and is refused, so a stray ``true`` is not read as 1."""
    if isinstance(value, bool) or not isinstance(value, int) or value <= 0:
        return None
    return value


def rules_from_v1(
    rules: Optional[Mapping[str, Any]], tiers: Sequence[Dict[str, Any]]
) -> Dict[str, Any]:
    """A version 1 rule set and the tier ladder's voting benefits, as the
    version 2 rule set that judges every member the same way.

    Per row: the version 1 waiting period for that type (a department tier
    takes the one for the status it counts as, as ``voter_type_key`` did),
    the election-wide attendance rule, and -- on status rows -- the tier's
    "may vote" flag and its attendance percentage. One deliberate difference:
    an administrative or social member's status row now applies to them as
    well as their class row (see the module docstring).
    """
    rules = rules if isinstance(rules, Mapping) else {}
    waits = rules.get("waiting_periods")
    waits = waits if isinstance(waits, Mapping) else {}
    election_wide = rules.get("attendance")
    shared_attendance = (
        [dict(election_wide)]
        if isinstance(election_wide, Mapping)
        and election_wide.get("mode") in ("count", "percent")
        else []
    )
    ranks_as = ranks_as_from_tiers(tiers)

    types: Dict[str, Dict[str, Any]] = {}
    for row in voter_rows(tiers):
        key = row["key"]
        tier: Optional[Mapping[str, Any]] = None
        if row["decided_by"] == "class":
            wait_key: Optional[str] = key
        else:
            tier = tier_for_status(tiers, key)
            if key in MemberStatus.ALL:
                wait_key = key if key in VOTER_TYPE_KEYS else None
            else:
                wait_key = ranks_as.get(key)

        may_vote = True
        wait: Optional[Dict[str, Any]] = None
        period = waits.get(wait_key) if wait_key else None
        if isinstance(period, Mapping):
            if period.get("mode") == "never":
                may_vote = False
            elif period.get("mode") == "months":
                months = _positive_int(period.get("months"))
                if months:
                    wait = {"months": months, "counted_from": "type"}

        attendance = [dict(a) for a in shared_attendance]
        if tier is not None:
            benefits = tier_benefits(tier)
            if not benefits.get("voting_eligible", True):
                may_vote = False
            min_pct = benefits.get("voting_min_attendance_pct", 0.0)
            if (
                benefits.get("voting_requires_meeting_attendance", False)
                and isinstance(min_pct, (int, float))
                and not isinstance(min_pct, bool)
                and min_pct > 0
            ):
                attendance.append(
                    {
                        "mode": "percent",
                        "min_pct": float(min_pct),
                        "period_months": _positive_int(
                            benefits.get("voting_attendance_period_months")
                        )
                        or 12,
                    }
                )

        if not may_vote:
            types[key] = {"may_vote": False, "wait": None, "attendance": []}
        else:
            types[key] = {"may_vote": True, "wait": wait, "attendance": attendance}
    return {"version": RULES_VERSION, "types": types}


def as_type_rules(
    rules: Optional[Mapping[str, Any]], tiers: Sequence[Dict[str, Any]]
) -> Dict[str, Any]:
    """``rules`` as a version 2 rule set, converting a version 1 one."""
    if rules is not None and is_type_rules(rules):
        return dict(rules)
    return rules_from_v1(rules, tiers)


@dataclass(frozen=True)
class RowWait:
    """Where one member stands against one row's "may vote" and wait.

    ``state`` is ``never`` (the row may not vote), ``no_rule``, ``waived``,
    ``eligible`` or ``waiting``; ``eligible_from`` is set when a date was
    known.
    """

    key: str
    label: str
    state: str
    months: Optional[int] = None
    eligible_from: Optional[date] = None
    counted_from: str = "type"


def row_wait_reason(outcome: RowWait) -> Optional[str]:
    """Why ``outcome`` keeps a member from voting, or None."""
    if outcome.state == "never":
        return f"{outcome.label} members may not vote"
    if outcome.state == "waiting" and outcome.eligible_from is not None:
        day = outcome.eligible_from
        since = (
            "joining the department"
            if outcome.counted_from == "joined"
            else f"becoming {outcome.label.lower()}"
        )
        # Month first ("Apr 30, 2027"), as the profile card shows dates;
        # %-d is not portable.
        return (
            f"{outcome.label} members may vote {outcome.months} months after "
            f"{since}; eligible from {day:%b} {day.day}, {day.year}"
        )
    return None


async def row_waits(
    tier_svc: "MembershipTierService",
    member: Any,
    organization_id: str,
    rules: Mapping[str, Any],
    ranks_as: Mapping[str, str],
    labels: Mapping[str, str],
    today: date,
) -> List[RowWait]:
    """One ``RowWait`` per row that judges ``member``.

    The rules are free-form JSON once stored, so a malformed row reads as
    "no rule" rather than raising: an exception here would take down a
    whole roster or ballot send, not one member. A secretary's waiver lifts
    a wait, never a "may not vote", which is a rule about the type.
    """
    types = rules.get("types")
    if not isinstance(types, Mapping):
        return []
    waived = bool(getattr(member, "voting_wait_waived", False))
    outcomes: List[RowWait] = []
    for key in member_row_keys(member, types, ranks_as):
        rule = types.get(key)
        label = labels.get(key) or key.title()
        if not isinstance(rule, Mapping):
            outcomes.append(RowWait(key, label, "no_rule"))
            continue
        if rule.get("may_vote", True) is False:
            outcomes.append(RowWait(key, label, "never"))
            continue
        wait = rule.get("wait")
        months = (
            _positive_int(wait.get("months")) if isinstance(wait, Mapping) else None
        )
        if months is None:
            outcomes.append(RowWait(key, label, "no_rule"))
            continue
        counted_from = (
            "joined"
            if isinstance(wait, Mapping) and wait.get("counted_from") == "joined"
            else "type"
        )
        if waived:
            outcomes.append(RowWait(key, label, "waived", months, None, counted_from))
            continue
        start = await tier_svc.get_wait_start(
            member,
            organization_id,
            by_class=key in CLASS_ROW_KEYS,
            counted_from=counted_from,
        )
        if start is None:
            # No recorded date is not evidence of a recent change.
            outcomes.append(RowWait(key, label, "eligible", months, None, counted_from))
            continue
        eligible_from = start + relativedelta(months=months)
        state = "eligible" if today >= eligible_from else "waiting"
        outcomes.append(RowWait(key, label, state, months, eligible_from, counted_from))
    return outcomes


async def attendance_reason(
    tier_svc: "MembershipTierService",
    user_id: str,
    organization_id: str,
    attendance: Any,
) -> Optional[str]:
    """Why the member fails one attendance rule, or None.

    Read defensively, as ``row_waits`` is: a malformed rule is skipped.
    """
    if not isinstance(attendance, Mapping):
        return None
    meeting_types = attendance.get("meeting_types")
    if not isinstance(meeting_types, list) or not all(
        isinstance(t, str) for t in meeting_types
    ):
        meeting_types = None
    mode = attendance.get("mode")
    if mode == "count":
        from app.services.membership_tier_service import required_recent_meetings

        min_meetings = _positive_int(attendance.get("min_meetings"))
        of_last = _positive_int(attendance.get("of_last_meetings"))
        if min_meetings is None or of_last is None:
            return None
        recent = await tier_svc.get_recent_meeting_attendance(
            user_id, organization_id, of_last, meeting_types
        )
        required = required_recent_meetings(
            min(min_meetings, of_last), of_last, recent.considered
        )
        if recent.attended < required:
            return (
                f"Attended {recent.attended} of the last {recent.considered} "
                f"meetings; {required} required to vote"
            )
    elif mode == "percent":
        min_pct = attendance.get("min_pct")
        period = _positive_int(attendance.get("period_months"))
        if (
            isinstance(min_pct, bool)
            or not isinstance(min_pct, (int, float))
            or min_pct <= 0
            or period is None
        ):
            return None
        actual_pct = await tier_svc.get_meeting_attendance_pct(
            user_id=user_id,
            organization_id=organization_id,
            period_months=period,
            meeting_types=meeting_types,
        )
        if actual_pct < min_pct:
            return (
                f"Meeting attendance is {actual_pct:.1f}% over the last "
                f"{period} months; {min_pct:g}% required to vote"
            )
    return None


async def type_rules_reason(
    tier_svc: "MembershipTierService",
    member: Any,
    organization_id: str,
    rules: Mapping[str, Any],
    ranks_as: Mapping[str, str],
    labels: Mapping[str, str],
    today: date,
) -> Optional[str]:
    """Why ``member`` fails a version 2 rule set, or None when they pass.

    "May vote" and waiting periods are reported before attendance, as the
    version 1 check did.
    """
    waits = await row_waits(
        tier_svc, member, organization_id, rules, ranks_as, labels, today
    )
    for outcome in waits:
        reason = row_wait_reason(outcome)
        if reason:
            return reason
    types = rules.get("types")
    if not isinstance(types, Mapping):
        return None
    for key in member_row_keys(member, types, ranks_as):
        rule = types.get(key)
        if not isinstance(rule, Mapping):
            continue
        attendance_rules = rule.get("attendance")
        if not isinstance(attendance_rules, list):
            continue
        for attendance in attendance_rules:
            reason = await attendance_reason(
                tier_svc, str(member.id), organization_id, attendance
            )
            if reason:
                return reason
    return None
