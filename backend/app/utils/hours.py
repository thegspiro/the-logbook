"""Quarter-hour reporting for logged time.

Time a member worked or was credited with is reported in quarter-hour
increments — the granularity it is entered at and the granularity a department
reports against. Storage stays in whole minutes; this module is the reporting
rule applied on the way out, so a figure in a CSV export matches the one the
member read on the screen it came from.

Two boundaries matter, and they are the same ones `frontend/src/utils/
hoursFormatting.ts` draws:

* **Averages are not recorded time.** Hours per member, hours per shift — an
  average is not constrained to the increment, and 2.5 hours over three shifts
  is 0.83, not 0.75. Those use :func:`round_hours_exact`.
* **Grading never reads a rounded figure.** Whether a requirement is met is
  decided on raw minutes. Rounding first turns a shortfall under an eighth of
  an hour into zero and marks a member compliant while they are short, which is
  the failure this rule exists to avoid rather than to cause.

Stored columns are likewise untouched: ``hours_completed`` on a training record
and ``duration_minutes`` on an attendance row keep what actually happened.
"""

import math
from typing import Iterable, Optional

#: The reporting increment for logged time.
QUARTER_HOUR = 0.25


def round_hours_to_quarter(hours: Optional[float]) -> float:
    """Round to the nearest quarter hour, with halfway values going up.

    ``math.floor(x + 0.5)`` breaks ties toward positive infinity, matching the
    frontend's ``Math.round`` so the two never disagree by an increment.
    Quarters are exactly representable in binary floating point, so the result
    carries none of the drift the input may have.
    """
    if hours is None:
        return 0.0
    value = float(hours)
    if not math.isfinite(value):
        return 0.0
    return math.floor(value / QUARTER_HOUR + 0.5) * QUARTER_HOUR


def hours_from_minutes(minutes: Optional[float]) -> float:
    """Stored minutes as reportable hours, on the quarter."""
    if minutes is None:
        return 0.0
    return round_hours_to_quarter(float(minutes) / 60.0)


def sum_hours_to_quarter(values: Iterable[Optional[float]]) -> float:
    """Total the rounded parts, so a total matches the figures beside it.

    Rounding the raw sum instead lets a report state 69.5 over parts reading
    66.75 and 3.
    """
    total = sum(round_hours_to_quarter(value) for value in values)
    return round_hours_to_quarter(total)


def sum_minutes_to_quarter(minutes: Iterable[Optional[float]]) -> float:
    """As :func:`sum_hours_to_quarter`, for values still in minutes."""
    return sum_hours_to_quarter(
        None if value is None else float(value) / 60.0 for value in minutes
    )


def round_hours_exact(hours: Optional[float]) -> float:
    """An hours figure that is *not* recorded time — an average, or a credit
    ceiling a percentage mapping produced. Kept off the quarter, with the float
    drift of a raw division trimmed away.
    """
    if hours is None:
        return 0.0
    value = float(hours)
    if not math.isfinite(value):
        return 0.0
    return round(value, 2)
