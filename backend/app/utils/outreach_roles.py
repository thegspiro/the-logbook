"""Canonical form for a community outreach event's staffing needs.

``event_requests.staffing_roles`` is untyped JSON, so it gets exactly one
stored shape, settled on every write rather than reconstructed by each reader
(CLAUDE.md pitfall #20):

    [{"role": "tour_guide", "count": 2, "essential": true},
     {"role": "photographer", "count": 1, "essential": false}]

``essential`` (owner decision, 2026-11-23) says whether the role's seats must
be filled for the day to count as staffed. A stored entry without it is
essential, as every role was before the flag existed; every reader goes
through ``normalize_staffing_roles``, which supplies it, so existing rows need
no backfill to read correctly, and the next write stores it.

Roles are department-configurable (``events.outreach_roles`` in organization
settings), which is why nothing here validates a role name against a fixed
list — the caller checks it against the department's own vocabulary. What this
module guarantees is the *shape*: a list of ``{"role": str, "count": int}``
with no duplicates, no blanks, no count outside the seat limits, and an
``essential`` flag on every entry.
"""

from typing import Any, Dict, List, Optional

from app.core.utils import list_within_detail_limit

# A sheet this size is a data error, not a staffing plan: the seat list that
# backs it is capped at 50 by app/utils/positions, so a larger count here would
# promise seats the shift cannot hold.
MAX_SEATS_PER_ROLE = 50
MAX_TOTAL_SEATS = 50


def normalize_staffing_roles(roles: Any) -> List[Dict[str, Any]]:
    """Return staffing needs as ``[{"role": str, "count": int, "essential": bool}]``.

    Entries with no usable role name are dropped — they cannot be signed up
    for and would only inflate the seat count. Repeats of the same role are
    summed rather than kept apart, so "2 tour guides" and "1 tour guide" in one
    payload become the three seats the sender clearly meant; the merged role
    is essential if either entry was, the reading that cannot leave a needed
    seat unwatched.
    """
    if not isinstance(roles, list):
        return []

    merged: Dict[str, int] = {}
    essential: Dict[str, bool] = {}
    for entry in roles:
        if isinstance(entry, str):
            name, count, needed = entry.strip(), 1, True
        elif isinstance(entry, dict):
            name = str(entry.get("role") or "").strip()
            count = _seat_count(entry.get("count"))
            needed = entry.get("essential") is not False
        else:
            continue
        if not name:
            continue
        merged[name] = min(merged.get(name, 0) + count, MAX_SEATS_PER_ROLE)
        essential[name] = essential.get(name, False) or needed

    return [
        {"role": name, "count": count, "essential": essential[name]}
        for name, count in merged.items()
    ]


def total_seats(roles: Any) -> int:
    """How many people the staffing needs add up to."""
    return sum(entry["count"] for entry in normalize_staffing_roles(roles))


def _seat_count(count: Any) -> int:
    """How many seats one entry stands for. Anything unusable means one."""
    # bool is an int subclass, but True is a flag, not "one seat".
    if isinstance(count, int) and not isinstance(count, bool) and count >= 1:
        return min(count, MAX_SEATS_PER_ROLE)
    return 1


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


def settle_type_role_presets(types: Any, configured_roles: Any) -> List[Dict[str, Any]]:
    """Settle each outreach type's ``default_roles`` into the canonical shape.

    A preset prefills a signup sheet, so it is held to what a sheet allows:
    roles the department has configured, and no more seats than a sheet can
    hold. An unknown role is refused rather than dropped — the administrator
    named it and would otherwise see the preset silently lose a line. A type
    with no preset is stored without the key, as before presets existed.

    Raises ``ValueError`` for an unknown role or an oversized preset.
    """
    known = role_labels(configured_roles)
    settled: List[Dict[str, Any]] = []
    for entry in types if isinstance(types, list) else []:
        if not isinstance(entry, dict) or not entry.get("value"):
            continue
        item = {key: value for key, value in entry.items() if key != "default_roles"}
        preset = normalize_staffing_roles(entry.get("default_roles"))
        if preset:
            unknown = sorted({need["role"] for need in preset} - set(known))
            if unknown:
                raise ValueError(
                    list_within_detail_limit(
                        f"{item.get('label') or item['value']}: unknown role(s) ",
                        unknown,
                    )
                )
            if sum(need["count"] for need in preset) > MAX_TOTAL_SEATS:
                raise ValueError(
                    f"{item.get('label') or item['value']}: a signup sheet holds "
                    f"at most {MAX_TOTAL_SEATS} people."
                )
            item["default_roles"] = preset
        settled.append(item)
    return settled
