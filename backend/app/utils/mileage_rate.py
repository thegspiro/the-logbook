"""
The department's rate per mile, as stored in the organization settings.

``finance.mileage_rate`` prices a mileage line's trip log
(``app/services/expense_mileage.py``). Kept free of application imports so the
settings request schema (``app/schemas/organization.py``) validates a rate
with the same rule the reader applies, without importing the services package.
"""

from decimal import Decimal, InvalidOperation
from typing import Any, Optional

MILEAGE_RATE_KEY = "mileage_rate"

# Bounds on the rate a department may set, in dollars per mile. The column is
# NUMERIC(6,3); five dollars is several times any rate in use.
MIN_MILEAGE_RATE = Decimal("0.001")
MAX_MILEAGE_RATE = Decimal("5.000")


def parse_mileage_rate(raw: Any) -> Optional[Decimal]:
    """A stored or submitted rate, or None when it is not one.

    Accepts a decimal string or a number; anything else, a value outside the
    bounds or one with more than three decimal places reads as unset rather
    than raising, so a mistyped setting stops trip logs (with a message) and
    nothing else (Pitfall #19, "read free-form JSON defensively").
    """
    if isinstance(raw, bool) or raw is None:
        return None
    try:
        value = Decimal(str(raw).strip())
    except (InvalidOperation, ValueError):
        return None
    if not value.is_finite():
        return None
    exponent = value.as_tuple().exponent
    if not isinstance(exponent, int) or exponent < -3:
        return None
    if not MIN_MILEAGE_RATE <= value <= MAX_MILEAGE_RATE:
        return None
    return value.quantize(Decimal("0.001"))
