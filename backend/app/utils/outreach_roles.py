"""Canonical form for a community outreach event's staffing needs.

``event_requests.staffing_roles`` is untyped JSON, so it gets exactly one
stored shape, settled on every write rather than reconstructed by each reader
(CLAUDE.md pitfall #20):

    [{"role": "tour_guide", "count": 2}, {"role": "educator", "count": 1}]

Roles are department-configurable (``events.outreach_roles`` in organization
settings), which is why nothing here validates a role name against a fixed
list — the caller checks it against the department's own vocabulary. What this
module guarantees is the *shape*: a list of ``{"role": str, "count": int}``
with no duplicates, no blanks, and no count outside the seat limits.
"""

from typing import Any, Dict, List, Optional

# A sheet this size is a data error, not a staffing plan: the seat list that
# backs it is capped at 50 by app/utils/positions, so a larger count here would
# promise seats the shift cannot hold.
MAX_SEATS_PER_ROLE = 50
MAX_TOTAL_SEATS = 50


def normalize_staffing_roles(roles: Any) -> List[Dict[str, Any]]:
    """Return staffing needs as ``[{"role": str, "count": int}]``.

    Entries with no usable role name are dropped — they cannot be signed up
    for and would only inflate the seat count. Repeats of the same role are
    summed rather than kept apart, so "2 tour guides" and "1 tour guide" in one
    payload become the three seats the sender clearly meant.
    """
    if not isinstance(roles, list):
        return []

    merged: Dict[str, int] = {}
    for entry in roles:
        if isinstance(entry, str):
            name, count = entry.strip(), 1
        elif isinstance(entry, dict):
            name = str(entry.get("role") or "").strip()
            count = _seat_count(entry.get("count"))
        else:
            continue
        if not name:
            continue
        merged[name] = min(merged.get(name, 0) + count, MAX_SEATS_PER_ROLE)

    return [{"role": name, "count": count} for name, count in merged.items()]


def total_seats(roles: Any) -> int:
    """How many people the staffing needs add up to."""
    return sum(entry["count"] for entry in normalize_staffing_roles(roles))


def _seat_count(count: Any) -> int:
    """How many seats one entry stands for. Anything unusable means one."""
    if isinstance(count, bool) or not isinstance(count, int):
        return 1
    if count < 1:
        return 1
    return min(count, MAX_SEATS_PER_ROLE)


def role_labels(configured: Any) -> Dict[str, str]:
    """Map role value -> label from a department's configured role list."""
    labels: Dict[str, str] = {}
    if isinstance(configured, list):
        for entry in configured:
            if isinstance(entry, dict) and entry.get("value"):
                labels[str(entry["value"])] = str(entry.get("label") or entry["value"])
    return labels


def role_label(configured: Any, role: Optional[str]) -> str:
    """A department's label for a role, or a humanized fallback.

    A role removed from settings after somebody signed up still has to render
    as something a coordinator recognises, so the stored value is humanized
    rather than shown raw or blanked.
    """
    if not role:
        return ""
    return role_labels(configured).get(role, role.replace("_", " ").title())
