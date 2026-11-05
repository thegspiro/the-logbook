"""Plausibility rules for the dates recorded on an inventory item.

Owner decision 2026-11-01 ("check only when a date changes"): a create checks
every date it writes, and an update checks only the dates it writes. Rows
saved before these rules existed can hold a warranty that ends before the
purchase, or a purchase date of 0001-01-01; applying the rules to the
*resulting* row on every update would refuse a quartermaster moving such an
item to another shelf, naming two fields the edit never touched.
"""

from datetime import date, datetime
from typing import Any, Mapping, Optional

ITEM_DATE_LABELS: dict[str, str] = {
    "purchase_date": "Purchase date",
    "warranty_expiration": "Warranty expiration",
    "last_inspection_date": "Last inspection date",
    "next_inspection_due": "Next inspection due",
}

EARLIEST_ITEM_YEAR = 1900
# Far enough out for a "lifetime" warranty typed as 2099, near enough to catch
# a mistyped 20250 or a five-digit year a date picker let through.
ITEM_DATE_YEARS_AHEAD = 100


def _as_date(value: Any) -> Optional[date]:
    """A date, or None for a value this check cannot read.

    The CSV import hands the service ISO strings rather than dates. One that
    does not parse is left to the column to refuse, as it always has been.
    """
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    if isinstance(value, str):
        try:
            return date.fromisoformat(value.strip())
        except ValueError:
            return None
    return None


def touches_item_dates(changes: Mapping[str, Any]) -> bool:
    """Whether ``changes`` writes any date this module checks."""
    return any(field in changes for field in ITEM_DATE_LABELS)


def item_date_error(
    changes: Mapping[str, Any],
    current: Optional[Mapping[str, Any]] = None,
    *,
    today: date,
) -> Optional[str]:
    """Why the dates in ``changes`` are implausible, or None if they are fine.

    ``changes`` holds the fields being written: a create's whole payload, or an
    update's ``exclude_unset`` payload. ``current`` holds the item's stored
    dates on update, and is omitted on create.

    On update a date counts as changed only when its value differs from the
    stored one. The item edit form sends every field it owns on every save
    (Pitfall #1), so "present in the payload" would put a stored bad pair back
    in front of the rule on any edit made from the screen. The warranty /
    purchase pair is compared when either side changes, against the stored
    other side, so editing one date without fixing the pair is refused.

    ``today`` is the department's date (``resolve_org_today``), not the
    server's: the server is UTC, already tomorrow for a US department every
    evening, and on New Year's Eve that moves the upper bound by a year.
    """
    latest_year = today.year + ITEM_DATE_YEARS_AHEAD

    if current is None:
        changed = {field for field in ITEM_DATE_LABELS if field in changes}
        stored: Mapping[str, Any] = {}
    else:
        stored = current
        changed = {
            field
            for field in ITEM_DATE_LABELS
            if field in changes
            and _as_date(changes[field]) != _as_date(stored.get(field))
        }

    for field, label in ITEM_DATE_LABELS.items():
        if field not in changed:
            continue
        value = _as_date(changes[field])
        if value is not None and not EARLIEST_ITEM_YEAR <= value.year <= latest_year:
            return f"{label} must be between {EARLIEST_ITEM_YEAR} and {latest_year}"

    if changed & {"purchase_date", "warranty_expiration"}:
        purchase = _as_date(
            changes["purchase_date"]
            if "purchase_date" in changes
            else stored.get("purchase_date")
        )
        warranty = _as_date(
            changes["warranty_expiration"]
            if "warranty_expiration" in changes
            else stored.get("warranty_expiration")
        )
        if purchase and warranty and warranty < purchase:
            return "Warranty expiration cannot be before the purchase date"

    return None
