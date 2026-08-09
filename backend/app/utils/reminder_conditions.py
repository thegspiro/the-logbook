"""Deadline-reminder settings for a training program.

A program carries two knobs for nagging an enrolled member about their
completion deadline:

``warning_days_before``
    The first warning, in days before the deadline. Every program has one
    (default 30).

``reminder_conditions``
    A JSON blob for the rest of the policy:

    ``days_before_deadline``
        When to warn — an int or a list of ints, in days before the deadline.
        Defaults to ``warning_days_before`` plus a 14- and 7-day follow-up, so a
        department that never opens this setting still gets a sensible ramp.

    ``send_if_below_percentage``
        Only warn a member whose progress is *below* this mark. A department
        that sets 40 stops pestering the recruits who are clearly on track and
        keeps the reminders meaningful. Defaults to 100 — warn everybody.

``milestone_threshold`` appeared in an early sketch of this blob and is
deliberately not honored: ``ProgramMilestone`` rows already fire progress-based
notifications, and two mechanisms for one job is how the two drift apart. Old
values stay in the column and are ignored on read; new writes drop the key.
"""

from typing import Any, Dict, Iterable, List, Optional

# Follow-ups added after the program's own ``warning_days_before`` when a
# department hasn't specified its own schedule.
DEFAULT_FOLLOW_UP_DAYS = (14, 7)

DEFAULT_WARNING_DAYS_BEFORE = 30


def _as_day_list(value: Any) -> List[int]:
    """Coerce an int, or a list of them, to whole non-negative days."""
    if value is None:
        return []
    candidates: Iterable[Any] = value if isinstance(value, (list, tuple)) else [value]
    days: List[int] = []
    for candidate in candidates:
        if isinstance(candidate, bool):
            continue
        try:
            day = int(candidate)
        except (TypeError, ValueError):
            continue
        if day >= 0:
            days.append(day)
    return days


def _as_percentage(value: Any) -> Optional[float]:
    if value is None or isinstance(value, bool):
        return None
    try:
        percentage = float(value)
    except (TypeError, ValueError):
        return None
    return min(100.0, max(0.0, percentage))


def normalize_reminder_conditions(
    raw: Any,
    warning_days_before: Optional[int] = None,
) -> Dict[str, Any]:
    """Resolve a program's reminder policy into concrete values.

    Always returns both keys, so callers never branch on "was this configured".
    """
    conditions = raw if isinstance(raw, dict) else {}

    first_warning = (
        warning_days_before
        if isinstance(warning_days_before, int)
        and not isinstance(warning_days_before, bool)
        and warning_days_before >= 0
        else DEFAULT_WARNING_DAYS_BEFORE
    )

    days = _as_day_list(conditions.get("days_before_deadline"))
    if not days:
        days = [first_warning, *DEFAULT_FOLLOW_UP_DAYS]

    below = _as_percentage(conditions.get("send_if_below_percentage"))

    return {
        # Descending so the earliest warning is first — the order an officer
        # reading the setting expects.
        "days_before_deadline": sorted(set(days), reverse=True),
        "send_if_below_percentage": 100.0 if below is None else below,
    }


def should_send_warning(
    days_left: int,
    progress_percentage: Optional[float],
    conditions: Dict[str, Any],
) -> bool:
    """Whether today is a warning day for this member under ``conditions``."""
    if days_left not in conditions["days_before_deadline"]:
        return False
    threshold = conditions["send_if_below_percentage"]
    if threshold >= 100.0:
        return True
    return (progress_percentage or 0.0) < threshold
