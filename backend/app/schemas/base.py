"""
Shared base classes for Pydantic response schemas.

MySQL DATETIME columns do not store timezone information, so SQLAlchemy
returns naive ``datetime`` objects.  Pydantic serialises these without a
``Z`` or offset (e.g. ``"2024-01-15T14:00:00"``), and browsers'
``new Date()`` interprets such strings as **local** time — not UTC.
This causes the frontend to display raw UTC values instead of converting
them to the user's timezone.

``UTCResponseBase`` fixes this globally: a ``model_validator`` stamps
every naive ``datetime`` field with ``tzinfo=UTC`` so the JSON response
carries an explicit timezone marker (``"2024-01-15T14:00:00Z"``).  All
API *response* schemas should inherit from ``UTCResponseBase`` instead
of plain ``BaseModel``.

``as_utc`` (and the ``UTCDateTime`` field type built on it) is the
request-side counterpart, for datetimes a request writes.
"""

from datetime import datetime, timezone
from typing import Annotated, Any, ClassVar, Optional, overload

from pydantic import (
    AfterValidator,
    BaseModel,
    ValidationInfo,
    field_validator,
    model_validator,
)


@overload
def as_utc(value: datetime) -> datetime:
    """A datetime in, a UTC datetime out."""


@overload
def as_utc(value: None) -> None:
    """No time in, no time out."""


def as_utc(value: Optional[datetime]) -> Optional[datetime]:
    """Convert an aware datetime to UTC; read an offset-less one as UTC.

    Apply it to every request datetime that is written to a DATETIME column.

    An **aware** value is converted rather than passed through. MySQL DATETIME
    keeps no offset and the driver formats a datetime by its wall clock —
    pymysql renders ``18:00-04:00`` as ``'... 18:00:00'`` — so storing it
    unchanged saves 18:00, which is read back as 18:00 UTC and shown four hours
    early on every surface that reads it.

    A **naive** value is read as UTC, the project-wide wire convention. A JSON
    body can mix the two forms, and comparing them raises ``TypeError``, which
    Pydantic v2 does not turn into a validation error: a mixed pair reaching a
    cross-field check escapes as a 500 instead of a 422.
    """
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


# A request datetime normalised by ``as_utc`` at validation time. Annotate a
# field with it (``Optional[UTCDateTime]`` for an optional one) instead of
# writing a per-field validator, so a new schema cannot forget the conversion.
UTCDateTime = Annotated[datetime, AfterValidator(as_utc)]


class UTCResponseBase(BaseModel):
    """BaseModel subclass that ensures naive datetimes carry UTC tzinfo.

    Inherit from this class (instead of ``BaseModel``) for every Pydantic
    schema that is used as a FastAPI **response** model.
    """

    @model_validator(mode="after")
    def _stamp_naive_datetimes_utc(self) -> "UTCResponseBase":
        # Read model_fields off the class, not the instance: Pydantic 2.11
        # deprecated instance access and removes it in v3.
        for name in type(self).model_fields:
            val = getattr(self, name)
            if isinstance(val, datetime) and val.tzinfo is None:
                object.__setattr__(self, name, val.replace(tzinfo=timezone.utc))
        return self


class RefusesNull(BaseModel):
    """Base for an update schema that refuses an explicit ``null`` on some fields.

    Update schemas type every field ``Optional`` so a request can omit it, and the
    handlers dump with ``exclude_unset``, so a ``null`` that survives to the write is
    an explicit "clear this". For a field whose column is NOT NULL, or whose response
    field cannot hold ``None``, clearing it is not a state the row can be in: the write
    fails at the flush, or is stored and then makes the row unreadable (a 500 on every
    later read). Refusing it here answers 422 before anything is written. An omitted
    key is untouched, because a validator does not run for a key that was not sent.

    A subclass names its fields in ``null_refused``.
    """

    null_refused: ClassVar[frozenset[str]] = frozenset()

    @field_validator("*")
    @classmethod
    def _refuse_null(cls, value: Any, info: ValidationInfo) -> Any:
        if value is None and info.field_name in cls.null_refused:
            raise ValueError(
                f"{info.field_name} cannot be null; leave the field out to keep "
                "its current value"
            )
        return value
