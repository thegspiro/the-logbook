"""How far ahead of a deadline or an event a reminder may be set.

A department rule, not a column range: 30 days. Applied to request schemas only,
so a response still serializes a reminder an earlier release stored further out.
The lead time feeds date arithmetic, so leaving it unbounded would let a typo
raise ``OverflowError`` where a 422 belongs.
"""

from typing import Annotated

from pydantic import Field

MAX_REMINDER_LEAD_DAYS = 30
MAX_REMINDER_LEAD_HOURS = MAX_REMINDER_LEAD_DAYS * 24

ReminderLeadDays = Annotated[int, Field(ge=0, le=MAX_REMINDER_LEAD_DAYS)]
ReminderLeadHours = Annotated[int, Field(ge=0, le=MAX_REMINDER_LEAD_HOURS)]
