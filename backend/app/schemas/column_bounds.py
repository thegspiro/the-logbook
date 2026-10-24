"""Value ranges the database columns behind request schemas can hold.

A request field whose type allows more than its column does passes validation
and then fails at flush as MySQL error 1264, which an endpoint can only report
as "An unexpected error occurred". Bounding the field at the schema turns that
into a 422 naming it.

These mirror the column types, not business limits: a rule such as "a quantity
is never negative" belongs on the field beside its own ``ge=``.
"""

from decimal import Decimal

INT32_MIN = -(2**31)  # Integer
INT32_MAX = 2**31 - 1  # Integer


def decimal_max(precision: int, scale: int) -> Decimal:
    """The largest magnitude a ``Numeric(precision, scale)`` column holds.

    ``Numeric(12, 2)`` holds up to 9999999999.99, so ``decimal_max(12, 2)``
    is that figure and ``-decimal_max(12, 2)`` the lowest value.
    """
    return Decimal(10) ** (precision - scale) - Decimal(1).scaleb(-scale)


MONEY_MAX = decimal_max(10, 2)  # Numeric(10, 2): the most common money column
FLOAT32_MAX = 3.4e38  # MySQL FLOAT is single precision
