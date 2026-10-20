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
MONEY_MAX = Decimal("99999999.99")  # Numeric(10, 2)
FLOAT32_MAX = 3.4e38  # MySQL FLOAT is single precision
