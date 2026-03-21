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
"""

from datetime import datetime, timezone

from pydantic import BaseModel, model_validator


class UTCResponseBase(BaseModel):
    """BaseModel subclass that ensures naive datetimes carry UTC tzinfo.

    Inherit from this class (instead of ``BaseModel``) for every Pydantic
    schema that is used as a FastAPI **response** model.
    """

    @model_validator(mode="after")
    def _stamp_naive_datetimes_utc(self) -> "UTCResponseBase":
        for name in self.model_fields:
            val = getattr(self, name)
            if isinstance(val, datetime) and val.tzinfo is None:
                object.__setattr__(self, name, val.replace(tzinfo=timezone.utc))
        return self
