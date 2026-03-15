"""
Shared schema utilities.

Provides ``stamp_utc`` — a reusable Pydantic ``model_validator`` body that
replaces naive ``datetime`` fields with UTC-aware equivalents so JSON
serialisation always includes ``+00:00``.
"""

from datetime import datetime, timezone

from pydantic import BaseModel


def stamp_naive_datetimes_utc(instance: BaseModel) -> BaseModel:
    """Ensure every naive ``datetime`` field on *instance* carries UTC tzinfo.

    MySQL ``DATETIME`` columns lack timezone metadata, so SQLAlchemy returns
    naive objects.  Without explicit ``tzinfo``, Pydantic serialises them
    without an offset (e.g. ``"2024-01-15T14:00:00"``).  The browser's
    ``new Date()`` then treats the value as **local** time, shifting the
    displayed time by the user's UTC offset.

    Calling this function inside a ``@model_validator(mode="after")``
    produces ``"2024-01-15T14:00:00+00:00"`` in every JSON response,
    which ``new Date()`` correctly interprets as UTC.
    """
    for name in instance.model_fields:
        val = getattr(instance, name)
        if isinstance(val, datetime) and val.tzinfo is None:
            object.__setattr__(instance, name, val.replace(tzinfo=timezone.utc))
    return instance
